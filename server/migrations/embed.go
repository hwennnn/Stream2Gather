// Package migrations embeds the database schema.
package migrations

import "embed"

// FS holds the goose migrations.
//
//go:embed *.sql
var FS embed.FS
