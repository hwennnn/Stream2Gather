package api

import (
	"bytes"
	"compress/gzip"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

func (s *Server) static(w http.ResponseWriter, r *http.Request) {
	clean := filepath.Clean(r.URL.Path)
	path := filepath.Join(s.WebDir, clean)
	if info, err := os.Stat(path); err == nil && !info.IsDir() {
		if strings.HasPrefix(clean, "/assets/") {
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		}
		// A browser checks a worker for updates against this, so it must never go stale.
		if clean == "/sw.js" {
			w.Header().Set("Cache-Control", "no-cache")
		}
		if clean == "/manifest.webmanifest" {
			w.Header().Set("Content-Type", "application/manifest+json")
		}
		s.serveFile(w, r, path, info)
		return
	}

	index := filepath.Join(s.WebDir, "index.html")
	info, err := os.Stat(index)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Cache-Control", "no-cache")
	s.serveFile(w, r, index, info)
}

var compressible = map[string]bool{".html": true, ".js": true, ".css": true, ".svg": true}

// serveFile compresses text assets once and keeps the result, since build
// output never changes while a server runs.
func (s *Server) serveFile(w http.ResponseWriter, r *http.Request, path string, info os.FileInfo) {
	extension := filepath.Ext(path)
	if !compressible[extension] {
		http.ServeFile(w, r, path)
		return
	}
	w.Header().Add("Vary", "Accept-Encoding")
	if !strings.Contains(r.Header.Get("Accept-Encoding"), "gzip") {
		http.ServeFile(w, r, path)
		return
	}

	compressed, err := s.compressed(path, info)
	if err != nil {
		http.ServeFile(w, r, path)
		return
	}
	w.Header().Set("Content-Type", mime.TypeByExtension(extension))
	w.Header().Set("Content-Encoding", "gzip")
	http.ServeContent(w, r, "", info.ModTime(), bytes.NewReader(compressed))
}

type compressedFile struct {
	modified time.Time
	body     []byte
}

func (s *Server) compressed(path string, info os.FileInfo) ([]byte, error) {
	if cached, ok := s.assets.Load(path); ok {
		if file := cached.(compressedFile); file.modified.Equal(info.ModTime()) {
			return file.body, nil
		}
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var buffer bytes.Buffer
	writer, err := gzip.NewWriterLevel(&buffer, gzip.BestCompression)
	if err != nil {
		return nil, err
	}
	if _, err := writer.Write(raw); err != nil {
		return nil, err
	}
	if err := writer.Close(); err != nil {
		return nil, err
	}
	s.assets.Store(path, compressedFile{modified: info.ModTime(), body: buffer.Bytes()})
	return buffer.Bytes(), nil
}
