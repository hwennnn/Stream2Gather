package api

import (
	"context"
	"net/http"
)

// voiceRoutes adds the voice routes. Track B owns this file.
func (s *Server) voiceRoutes(*http.ServeMux) {}

// removeFromVoice drops someone from a room's call. A crew removal calls this,
// and it does nothing until voice exists.
func (s *Server) removeFromVoice(_ context.Context, _, _ string) error { return nil }
