package main

import (
	"context"
	"errors"
	"log/slog"

	"stream2gather/internal/config"
)

// notifier delivers web push. Track B owns this file.
func notifier(context.Context, config.Config, *slog.Logger) error {
	return errors.New("the notifier is not built yet")
}
