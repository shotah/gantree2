package snapshot

import (
	"context"
	"database/sql"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
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
	r := New(Options{Put: URLs{DB: "https://r2.example/db", Self: "https://r2.example/self"}})
	r.SetPut(URLs{DB: "https://r2.example/new-db"})
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.put.DB != "https://r2.example/new-db" || r.put.Self != "https://r2.example/self" {
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
