// Command mint-account makes a signed-in test account for local browser tests, so
// they need no real sign-in. It signs with the local session key, and refuses to
// run anywhere but dev.
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"stream2gather/internal/auth"
	"stream2gather/internal/config"
	"stream2gather/internal/ids"
	"stream2gather/internal/store"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run() error {
	if len(os.Args) != 2 {
		return fmt.Errorf("usage: mint-account <name>")
	}
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	if cfg.Env != "dev" {
		return fmt.Errorf("mint-account runs only in dev, not %q", cfg.Env)
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()
	name := os.Args[1]
	account, err := store.NewPostgres(pool).LinkClerkUser(ctx, "user_"+ids.New(), "", "u_"+ids.New(), name, "")
	if err != nil {
		return err
	}
	issuer, err := auth.NewIssuer(cfg.SessionKey)
	if err != nil {
		return err
	}
	token, err := issuer.Issue(auth.Claims{Subject: account.ID, Name: name, Account: true, Version: account.SessionVersion}, time.Hour)
	if err != nil {
		return err
	}
	return json.NewEncoder(os.Stdout).Encode(map[string]string{"id": account.ID, "cookie": token})
}
