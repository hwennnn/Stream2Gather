package main

import (
	"context"
	"io"
	"net"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
)

func listening(t *testing.T, handler http.Handler, read time.Duration) string {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	server := newHTTPServer("", handler, read)
	go func() { _ = server.Serve(listener) }()
	t.Cleanup(func() { _ = server.Close() })
	return listener.Addr().String()
}

func TestASlowBodyIsCutOff(t *testing.T) {
	addr := listening(t, http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		_, _ = io.Copy(io.Discard, r.Body)
	}), 100*time.Millisecond)

	conn, err := net.Dial("tcp", addr)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	if _, err := conn.Write([]byte("POST / HTTP/1.1\r\nHost: x\r\nContent-Length: 1000\r\n\r\n")); err != nil {
		t.Fatal(err)
	}
	if err := conn.SetReadDeadline(time.Now().Add(3 * time.Second)); err != nil {
		t.Fatal(err)
	}
	if _, err := io.ReadAll(conn); err != nil {
		t.Fatalf("still open: %v", err)
	}
}

func TestASocketOutlivesTheReadTimeout(t *testing.T) {
	addr := listening(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ws, err := websocket.Accept(w, r, nil)
		if err != nil {
			return
		}
		defer ws.CloseNow()
		kind, message, err := ws.Read(context.Background())
		if err == nil {
			_ = ws.Write(context.Background(), kind, message)
		}
	}), 50*time.Millisecond)

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	ws, _, err := websocket.Dial(ctx, "ws://"+addr, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer ws.CloseNow()
	time.Sleep(200 * time.Millisecond)
	if err := ws.Write(ctx, websocket.MessageText, []byte("still here")); err != nil {
		t.Fatal(err)
	}
	_, reply, err := ws.Read(ctx)
	if err != nil || !strings.Contains(string(reply), "still here") {
		t.Fatalf("reply %q, %v", reply, err)
	}
}
