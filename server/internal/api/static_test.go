package api

import (
	"compress/gzip"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func staticServer(t *testing.T) *Server {
	t.Helper()
	dir := t.TempDir()
	files := map[string]string{
		"index.html":  "<html>app</html>",
		"assets/a.js": strings.Repeat("console.log(1);", 200),
		"sample.mp4":  "video",
	}
	for name, body := range files {
		path := filepath.Join(dir, name)
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return &Server{WebDir: dir}
}

func get(s *Server, path, encoding string) *httptest.ResponseRecorder {
	request := httptest.NewRequest(http.MethodGet, path, nil)
	if encoding != "" {
		request.Header.Set("Accept-Encoding", encoding)
	}
	recorder := httptest.NewRecorder()
	s.static(recorder, request)
	return recorder
}

func TestAssetsAreCompressedAndCachedForever(t *testing.T) {
	s := staticServer(t)
	response := get(s, "/assets/a.js", "gzip, br")

	if response.Header().Get("Content-Encoding") != "gzip" {
		t.Fatalf("headers = %v", response.Header())
	}
	if !strings.Contains(response.Header().Get("Cache-Control"), "immutable") {
		t.Fatalf("cache = %q", response.Header().Get("Cache-Control"))
	}
	if !strings.Contains(response.Header().Get("Content-Type"), "javascript") {
		t.Fatalf("type = %q", response.Header().Get("Content-Type"))
	}

	reader, err := gzip.NewReader(response.Body)
	if err != nil {
		t.Fatal(err)
	}
	body, err := io.ReadAll(reader)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(string(body), "console.log(1);") {
		t.Fatalf("body = %q", body[:20])
	}
}

func TestClientsWithoutGzipGetPlainFiles(t *testing.T) {
	response := get(staticServer(t), "/assets/a.js", "")
	if response.Header().Get("Content-Encoding") != "" {
		t.Fatalf("headers = %v", response.Header())
	}
}

func TestMediaIsNotCompressed(t *testing.T) {
	response := get(staticServer(t), "/sample.mp4", "gzip")
	if response.Header().Get("Content-Encoding") != "" {
		t.Fatalf("headers = %v", response.Header())
	}
}

func TestUnknownPathsFallBackToTheApp(t *testing.T) {
	response := get(staticServer(t), "/some/page", "")
	if !strings.Contains(response.Body.String(), "app") {
		t.Fatalf("body = %q", response.Body.String())
	}
}

func TestPathsCannotEscapeTheBuild(t *testing.T) {
	s := staticServer(t)
	secret := filepath.Join(filepath.Dir(s.WebDir), "secret.txt")
	if err := os.WriteFile(secret, []byte("secret"), 0o644); err != nil {
		t.Fatal(err)
	}
	defer os.Remove(secret)

	response := get(s, "/../secret.txt", "")
	if strings.Contains(response.Body.String(), "secret") {
		t.Fatal("read a file outside the build")
	}
}
