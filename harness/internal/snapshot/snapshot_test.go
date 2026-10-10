package snapshot

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/base64"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestRestoreAndPublish(t *testing.T) {
	var mu sync.Mutex
	puts := map[string][]byte{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/db":
			if r.Method == http.MethodGet {
				_, _ = w.Write([]byte("db-bytes"))
				return
			}
			body, _ := io.ReadAll(r.Body)
			if r.Header.Get("Content-Type") != "application/octet-stream" {
				t.Errorf("content-type %q", r.Header.Get("Content-Type"))
			}
			mu.Lock()
			puts["db"] = body
			mu.Unlock()
			w.WriteHeader(http.StatusNoContent)
		case "/self":
			if r.Method == http.MethodGet {
				_, _ = w.Write([]byte("- dry\n"))
				return
			}
			body, _ := io.ReadAll(r.Body)
			mu.Lock()
			puts["self"] = body
			mu.Unlock()
			w.WriteHeader(http.StatusOK)
		case "/missing":
			http.NotFound(w, r)
		case "/boom":
			http.Error(w, "no", http.StatusInternalServerError)
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()

	data := t.TempDir()
	persona := t.TempDir()
	r := New(Options{
		DataDir:    data,
		PersonaDir: persona,
		Get:        URLs{DB: srv.URL + "/db", Self: srv.URL + "/self"},
		Put:        URLs{DB: srv.URL + "/db", Self: srv.URL + "/self"},
	})
	res, err := r.Restore(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if res.Files != 2 {
		t.Fatalf("files %d", res.Files)
	}
	db, err := os.ReadFile(filepath.Join(data, DBFile))
	if err != nil || string(db) != "db-bytes" {
		t.Fatalf("db %q %v", db, err)
	}
	self, err := os.ReadFile(filepath.Join(data, SelfFile))
	if err != nil || string(self) != "- dry\n" {
		t.Fatalf("self data %q %v", self, err)
	}
	copied, err := os.ReadFile(filepath.Join(persona, SelfFile))
	if err != nil || string(copied) != "- dry\n" {
		t.Fatalf("self persona %q %v", copied, err)
	}

	if err := os.WriteFile(filepath.Join(persona, SelfFile), []byte("- later\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	pub, err := r.Publish(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if pub.Files != 2 || pub.Bytes != int64(len("db-bytes")+len("- later\n")) || pub.Stamp == "" {
		t.Fatalf("%+v", pub)
	}
	mu.Lock()
	defer mu.Unlock()
	if string(puts["db"]) != "db-bytes" || string(puts["self"]) != "- later\n" {
		t.Fatalf("puts %#v", puts)
	}
}

func TestRestore_NotFoundIsFresh(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.NotFound(w, r)
	}))
	defer srv.Close()
	data := t.TempDir()
	r := New(Options{DataDir: data, Get: URLs{DB: srv.URL + "/nope", Self: srv.URL + "/nope"}})
	res, err := r.Restore(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if res.Files != 0 {
		t.Fatalf("files %d", res.Files)
	}
	if _, err := os.Stat(filepath.Join(data, DBFile)); !os.IsNotExist(err) {
		t.Fatalf("db created: %v", err)
	}
}

func TestRestore_HTTPErrorAndBadScheme(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "no", http.StatusBadGateway)
	}))
	defer srv.Close()
	r := New(Options{DataDir: t.TempDir(), Get: URLs{DB: srv.URL + "/db"}})
	if _, err := r.Restore(context.Background()); err == nil {
		t.Fatal("want http error")
	}
	r = New(Options{DataDir: t.TempDir(), Get: URLs{DB: "file:///tmp/gantry.db"}})
	if _, err := r.Restore(context.Background()); err == nil {
		t.Fatal("want scheme error")
	}
}

func TestPublish_SkipsMissingAndEmpty(t *testing.T) {
	r := New(Options{DataDir: t.TempDir(), Put: URLs{}})
	res, err := r.Publish(context.Background())
	if err != nil || res.Files != 0 {
		t.Fatalf("%+v %v", res, err)
	}
	var hits int
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits++
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()
	r = New(Options{DataDir: t.TempDir(), Put: URLs{DB: srv.URL + "/db", Self: srv.URL + "/self"}})
	res, err = r.Publish(context.Background())
	if err != nil || res.Files != 0 || hits != 0 {
		t.Fatalf("%+v %v hits=%d", res, err, hits)
	}
}

func TestPublish_SQLiteBody(t *testing.T) {
	data := t.TempDir()
	path := filepath.Join(data, DBFile)
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`CREATE TABLE t (x TEXT); INSERT INTO t VALUES ('hi')`); err != nil {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	var body []byte
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ = io.ReadAll(r.Body)
		w.WriteHeader(http.StatusCreated)
	}))
	defer srv.Close()
	runner := New(Options{DataDir: data, Put: URLs{DB: srv.URL + "/db"}})
	res, err := runner.Publish(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if res.Files != 1 || len(body) < 15 || string(body[:15]) != "SQLite format 3" {
		t.Fatalf("files=%d prefix=%q len=%d", res.Files, body, len(body))
	}
}

func TestLoop_TickAndCancel(t *testing.T) {
	var n atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n.Add(1)
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, DBFile), []byte("db"), 0o644); err != nil {
		t.Fatal(err)
	}
	r := New(Options{
		DataDir:  dir,
		Interval: 20 * time.Millisecond,
		Put:      URLs{DB: srv.URL + "/db"},
	})
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		r.Loop(ctx, func(Result, error) {})
		close(done)
	}()
	deadline := time.Now().Add(2 * time.Second)
	for n.Load() < 1 && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	cancel()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("loop did not stop")
	}
	if n.Load() < 1 {
		t.Fatal("no put")
	}

	quiet := New(Options{DataDir: dir, Interval: 0})
	ctx, cancel = context.WithCancel(context.Background())
	done = make(chan struct{})
	go func() {
		quiet.Loop(ctx, nil)
		close(done)
	}()
	cancel()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("zero interval loop did not stop")
	}
}

func TestSetPut_KeepsEmptyFields(t *testing.T) {
	r := New(Options{Put: URLs{DB: "https://r2.example/db", Self: "https://r2.example/self", Tokens: "https://r2.example/tokens"}})
	r.SetPut(URLs{DB: "https://r2.example/new-db"})
	r.SetPut(URLs{Tokens: "https://r2.example/new-tokens"})
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.put.DB != "https://r2.example/new-db" || r.put.Self != "https://r2.example/self" || r.put.Tokens != "https://r2.example/new-tokens" {
		t.Fatalf("%+v", r.put)
	}
}

func TestPlace_EmptySkipped(t *testing.T) {
	if err := Place("", "x"); err != nil {
		t.Fatal(err)
	}
	if err := Place(filepath.Join(t.TempDir(), "a.txt"), ""); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "sub", "PERSONA.md")
	if err := Place(path, "be brief\n"); err != nil {
		t.Fatal(err)
	}
	body, err := os.ReadFile(path)
	if err != nil || string(body) != "be brief\n" {
		t.Fatalf("%q %v", body, err)
	}
}

func TestTokens_PutAndRestore(t *testing.T) {
	key := bytes.Repeat([]byte{4}, 32)
	b64 := base64.StdEncoding.EncodeToString(key)
	secret := []byte(`{"refresh_token":"s3cret-value"}`)
	var mu sync.Mutex
	var stored []byte
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/tokens" {
			http.NotFound(w, r)
			return
		}
		if r.Method == http.MethodPut {
			if r.Header.Get("Content-Type") != "application/octet-stream" {
				t.Errorf("content-type %q", r.Header.Get("Content-Type"))
			}
			body, _ := io.ReadAll(r.Body)
			if bytes.Contains(body, []byte("refresh_token")) {
				t.Errorf("plaintext uploaded")
			}
			mu.Lock()
			stored = body
			mu.Unlock()
			w.WriteHeader(http.StatusNoContent)
			return
		}
		mu.Lock()
		body := append([]byte(nil), stored...)
		mu.Unlock()
		if body == nil {
			http.NotFound(w, r)
			return
		}
		_, _ = w.Write(body)
	}))
	defer srv.Close()

	data := t.TempDir()
	writeToken(t, data, ".config/ghealth/tokens.json", string(secret))
	writeToken(t, data, ".env", "LLM_API_KEY=nope")
	r := New(Options{
		DataDir: data,
		Key:     b64,
		Put:     URLs{Tokens: srv.URL + "/tokens"},
		Get:     URLs{Tokens: srv.URL + "/tokens"},
	})
	pub, err := r.Publish(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if pub.Files != 1 || pub.Bytes == 0 || pub.Stamp == "" {
		t.Fatalf("%+v", pub)
	}
	mu.Lock()
	blob := append([]byte(nil), stored...)
	mu.Unlock()
	plain, err := DecryptTokens(key, blob)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(plain, []byte("LLM_API_KEY")) || !bytes.Contains(plain, secret) {
		t.Fatal("tar contents")
	}

	fresh := t.TempDir()
	r2 := New(Options{DataDir: fresh, Key: "  " + b64 + "\n", Get: URLs{Tokens: srv.URL + "/tokens"}})
	res, err := r2.Restore(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if res.Files != 1 {
		t.Fatalf("files %d", res.Files)
	}
	got, err := os.ReadFile(filepath.Join(fresh, ".config", "ghealth", "tokens.json"))
	if err != nil || !bytes.Equal(got, secret) {
		t.Fatalf("%q %v", got, err)
	}
	if _, err := os.Stat(filepath.Join(fresh, ".env")); !os.IsNotExist(err) {
		t.Fatalf("env restored: %v", err)
	}

	wrongKey := base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{5}, 32))
	wrong := New(Options{DataDir: t.TempDir(), Key: wrongKey, Get: URLs{Tokens: srv.URL + "/tokens"}})
	if _, err := wrong.Restore(context.Background()); err == nil {
		t.Fatal("want wrong key error")
	}
}

func TestRestore_TokensNotFound(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.NotFound(w, r)
	}))
	defer srv.Close()
	key := base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{1}, 32))
	r := New(Options{DataDir: t.TempDir(), Key: key, Get: URLs{Tokens: srv.URL + "/tokens"}})
	res, err := r.Restore(context.Background())
	if err != nil || res.Files != 0 {
		t.Fatalf("%+v %v", res, err)
	}
}

func TestPublish_NoTokenFilesSkips(t *testing.T) {
	var hits int
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits++
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()
	key := base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{2}, 32))
	r := New(Options{DataDir: t.TempDir(), Key: key, Put: URLs{Tokens: srv.URL + "/tokens"}})
	res, err := r.Publish(context.Background())
	if err != nil || res.Files != 0 || hits != 0 {
		t.Fatalf("%+v %v hits=%d", res, err, hits)
	}
}

func TestPublish_MissingKeySkipsTokens(t *testing.T) {
	keys := []struct {
		name string
		key  string
	}{
		{name: "empty", key: ""},
		{name: "garbage", key: "%%%"},
		{name: "short", key: base64.StdEncoding.EncodeToString([]byte("short"))},
	}
	for _, tc := range keys {
		t.Run(tc.name, func(t *testing.T) {
			var buf bytes.Buffer
			prev := slog.Default()
			slog.SetDefault(slog.New(slog.NewTextHandler(&buf, nil)))
			t.Cleanup(func() { slog.SetDefault(prev) })

			var hits int
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				hits++
				w.WriteHeader(http.StatusOK)
			}))
			defer srv.Close()
			data := t.TempDir()
			writeToken(t, data, ".strava/tokens.json", "secret-token")
			r := New(Options{
				DataDir: data,
				Key:     tc.key,
				Get:     URLs{Tokens: srv.URL + "/tokens"},
				Put:     URLs{Tokens: srv.URL + "/tokens"},
			})
			if _, err := r.Restore(context.Background()); err != nil {
				t.Fatal(err)
			}
			res, err := r.Publish(context.Background())
			if err != nil || res.Files != 0 {
				t.Fatalf("%+v %v", res, err)
			}
			if _, err := r.Publish(context.Background()); err != nil {
				t.Fatal(err)
			}
			if hits != 0 {
				t.Fatalf("hits %d", hits)
			}
			if strings.Count(buf.String(), "tokens skipped, no key") != 1 {
				t.Fatalf("log %q", buf.String())
			}
		})
	}
}
