package main

import (
	"bytes"
	"encoding/json"
	"testing"

	"github.com/shotah/pendant-mcp/tools"
)

func TestHostManifestListsOptionalEnvParams(t *testing.T) {
	t.Parallel()

	var buf bytes.Buffer
	if err := encodeHostManifest(&buf); err != nil {
		t.Fatalf("encodeHostManifest() error = %v", err)
	}

	var got map[string]any
	if err := json.Unmarshal(buf.Bytes(), &got); err != nil {
		t.Fatalf("decode: %v\n%s", err, buf.String())
	}

	if got["name"] != "chat" {
		t.Errorf("name = %v, want chat", got["name"])
	}
	if got["command"] != "chat" {
		t.Errorf("command = %v, want chat", got["command"])
	}

	required, _ := got["env_keys"].([]any)
	if len(required) != 0 {
		t.Errorf("env_keys should be empty (crane already has mailbox + bearer): %v", required)
	}

	optional, _ := got["optional_env_keys"].([]any)
	listed := map[string]bool{}
	for _, k := range optional {
		s, ok := k.(string)
		if !ok {
			t.Fatalf("optional_env_keys item %T, want string", k)
		}
		listed[s] = true
	}
	for _, want := range tools.OptionalEnvKeys() {
		if !listed[want] {
			t.Errorf("optional_env_keys missing %q: %v", want, optional)
		}
	}
}
