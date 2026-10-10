package main

import (
	"bytes"
	"encoding/xml"
	"os"
	"testing"
	"unicode/utf8"

	"github.com/shotah/image-generation-mcp/server"
	"github.com/shotah/image-generation-mcp/tools"
)

func TestBannerSVGWellFormed(t *testing.T) {
	t.Parallel()
	raw, err := os.ReadFile("assets/banner.svg")
	if err != nil {
		t.Fatal(err)
	}
	if !utf8.Valid(raw) {
		t.Fatal("assets/banner.svg is not valid UTF-8")
	}
	for i, b := range raw {
		if b < 0x20 && b != '\t' && b != '\n' && b != '\r' {
			t.Fatalf("illegal XML control byte 0x%02x at offset %d", b, i)
		}
	}
	if err := xml.Unmarshal(raw, new(struct{})); err != nil {
		t.Fatalf("assets/banner.svg is not well-formed XML: %v", err)
	}
	if !bytes.HasPrefix(bytes.TrimSpace(raw), []byte("<svg")) {
		t.Fatal("assets/banner.svg must start with <svg")
	}
}

func TestRegister(t *testing.T) {
	t.Parallel()
	s := server.New()
	tools.Register(s)
	if s == nil {
		t.Fatal("server is nil")
	}
}
