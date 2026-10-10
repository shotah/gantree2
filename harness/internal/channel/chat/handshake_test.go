package chat

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

func TestHandshake_ConfigFirstAndSocketStaysOpen(t *testing.T) {
	up := websocket.Upgrader{}
	next := make(chan struct{})
	release := make(chan struct{})
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer tok" {
			http.Error(w, "no", http.StatusUnauthorized)
			return
		}
		c, err := up.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer c.Close()
		_ = c.WriteMessage(websocket.TextMessage, []byte(`{"kind":"theme","theme":"siren"}`))
		_ = c.WriteMessage(websocket.TextMessage, []byte(`{"kind":"config","persona":"be brief","restore":{"gantry_db":"https://r2.example/db"}}`))
		select {
		case <-next:
		case <-release:
			return
		}
		_ = c.WriteMessage(websocket.TextMessage, []byte(`{"kind":"ack"}`))
		<-release
	}))
	defer srv.Close()
	defer close(release)

	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws/kit"
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	sock, frame, err := Handshake(ctx, wsURL, "tok")
	if err != nil {
		t.Fatal(err)
	}
	defer sock.Close()
	if frame.Persona != "be brief" || frame.Restore.DB == "" || frame.Kind != KindConfig {
		t.Fatalf("%+v", frame)
	}
	cancel()
	close(next)
	_, raw, err := sock.ReadMessage()
	if err != nil {
		t.Fatal(err)
	}
	kind, err := KindOf(raw)
	if err != nil || kind != "ack" {
		t.Fatalf("after handshake %s %v", raw, err)
	}
}

func TestHandshake_TimesOut(t *testing.T) {
	up := websocket.Upgrader{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, err := up.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer c.Close()
		time.Sleep(time.Second)
	}))
	defer srv.Close()
	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws/kit"
	ctx, cancel := context.WithTimeout(context.Background(), 150*time.Millisecond)
	defer cancel()
	_, _, err := Handshake(ctx, wsURL, "tok")
	if err == nil {
		t.Fatal("expected timeout")
	}
}

func TestHandshake_BadURL(t *testing.T) {
	_, _, err := Handshake(context.Background(), "not a url", "tok")
	if err == nil {
		t.Fatal("expected error")
	}
}
