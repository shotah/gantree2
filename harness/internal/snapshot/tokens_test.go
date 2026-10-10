package snapshot

import (
	"archive/tar"
	"bytes"
	"errors"
	"io"
	"os"
	"path/filepath"
	"testing"
	"time"
)

type tarEnt struct {
	name string
	body string
	typ  byte
	link string
}

func tarBytes(t *testing.T, files []tarEnt) []byte {
	t.Helper()
	var buf bytes.Buffer
	tw := tar.NewWriter(&buf)
	for _, f := range files {
		typ := f.typ
		if typ == 0 {
			typ = tar.TypeReg
		}
		body := []byte(f.body)
		size := int64(len(body))
		if typ != tar.TypeReg && typ != tar.TypeRegA {
			size = 0
			body = nil
		}
		hdr := &tar.Header{
			Name:     f.name,
			Mode:     0o600,
			Size:     size,
			Typeflag: typ,
			Linkname: f.link,
			ModTime:  time.Unix(0, 0).UTC(),
		}
		if err := tw.WriteHeader(hdr); err != nil {
			t.Fatalf("header %q: %v", f.name, err)
		}
		if len(body) > 0 {
			if _, err := tw.Write(body); err != nil {
				t.Fatal(err)
			}
		}
	}
	if err := tw.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func tarNames(t *testing.T, plain []byte) []string {
	t.Helper()
	tr := tar.NewReader(bytes.NewReader(plain))
	var names []string
	for {
		hdr, err := tr.Next()
		if errors.Is(err, io.EOF) {
			return names
		}
		if err != nil {
			t.Fatal(err)
		}
		names = append(names, hdr.Name)
	}
}

func writeToken(t *testing.T, dataDir, rel, body string) {
	t.Helper()
	path := filepath.Join(dataDir, filepath.FromSlash(rel))
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
}

func TestPackUnpack_RoundTrip(t *testing.T) {
	data := t.TempDir()
	writeToken(t, data, ".google_workspace_mcp/credentials/m.json", "m-token")
	writeToken(t, data, ".google_workspace_mcp/credentials/a.json", "a-token")
	writeToken(t, data, ".google_workspace_mcp/credentials/oauth_pending.json", "pending")
	writeToken(t, data, ".google_workspace_mcp/credentials/nested/nope.json", "nested")
	writeToken(t, data, ".strava/tokens.json", "strava-token")
	writeToken(t, data, ".strava/oauth_pending.json", "strava-pending")
	writeToken(t, data, ".config/ghealth/tokens.json", "health-token")
	writeToken(t, data, ".config/ghealth/oauth_pending.json", "health-pending")
	writeToken(t, data, ".config/garmin/session.json", "garmin-session")
	writeToken(t, data, ".config/garmin/mfa_pending.json", "garmin-mfa")
	writeToken(t, data, ".config/garmin/extra.json", "garmin-extra")
	writeToken(t, data, "gantry.db", "db")
	writeToken(t, data, "SELF.md", "self")
	writeToken(t, data, ".env", "LLM_API_KEY=nope")
	writeToken(t, data, "mcp.toml", "toml")
	writeToken(t, data, "debug.log", "log")

	link := filepath.Join(data, ".strava", "linked.json")
	if err := os.Symlink(filepath.Join(data, ".env"), link); err != nil {
		t.Fatal(err)
	}

	first, n, err := packTokens(data, maxSnapshotBytes)
	if err != nil {
		t.Fatal(err)
	}
	second, n2, err := packTokens(data, maxSnapshotBytes)
	if err != nil {
		t.Fatal(err)
	}
	if n != 5 || n2 != 5 || !bytes.Equal(first, second) {
		t.Fatalf("n=%d/%d deterministic=%v", n, n2, bytes.Equal(first, second))
	}
	want := []string{
		".google_workspace_mcp/credentials/a.json",
		".google_workspace_mcp/credentials/m.json",
		".strava/tokens.json",
		".config/ghealth/tokens.json",
		".config/garmin/session.json",
	}
	if got := tarNames(t, first); !sameStrings(got, want) {
		t.Fatalf("names %#v", got)
	}
	for _, banned := range []string{"oauth_pending", "gantry.db", "SELF.md", ".env", "mcp.toml", "debug.log", "nested", "mfa_pending", "extra.json", "linked.json", "LLM_API_KEY"} {
		if bytes.Contains(first, []byte(banned)) {
			t.Fatalf("tar contains %s", banned)
		}
	}

	fresh := t.TempDir()
	wrote, err := unpackTokens(fresh, first, maxSnapshotBytes)
	if err != nil {
		t.Fatal(err)
	}
	if wrote != 5 {
		t.Fatalf("wrote %d", wrote)
	}
	for _, rel := range want {
		body, err := os.ReadFile(filepath.Join(fresh, filepath.FromSlash(rel)))
		if err != nil {
			t.Fatal(err)
		}
		info, err := os.Stat(filepath.Join(fresh, filepath.FromSlash(rel)))
		if err != nil {
			t.Fatal(err)
		}
		if info.Mode().Perm() != 0o600 {
			t.Fatalf("%s mode %o", rel, info.Mode().Perm())
		}
		switch rel {
		case ".google_workspace_mcp/credentials/a.json":
			if string(body) != "a-token" {
				t.Fatalf("%s %q", rel, body)
			}
		case ".google_workspace_mcp/credentials/m.json":
			if string(body) != "m-token" {
				t.Fatalf("%s %q", rel, body)
			}
		case ".strava/tokens.json":
			if string(body) != "strava-token" {
				t.Fatalf("%s %q", rel, body)
			}
		case ".config/ghealth/tokens.json":
			if string(body) != "health-token" {
				t.Fatalf("%s %q", rel, body)
			}
		case ".config/garmin/session.json":
			if string(body) != "garmin-session" {
				t.Fatalf("%s %q", rel, body)
			}
		}
	}
	if _, err := os.Stat(filepath.Join(fresh, "gantry.db")); !os.IsNotExist(err) {
		t.Fatalf("db restored: %v", err)
	}
}

func TestPackTokens_EmptyAndSymlinkSkipped(t *testing.T) {
	plain, n, err := packTokens(t.TempDir(), maxSnapshotBytes)
	if err != nil || n != 0 || plain != nil {
		t.Fatalf("n=%d plain=%d err=%v", n, len(plain), err)
	}
	data := t.TempDir()
	dir := filepath.Join(data, ".strava")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join(data, "missing"), filepath.Join(dir, "tokens.json")); err != nil {
		t.Fatal(err)
	}
	plain, n, err = packTokens(data, maxSnapshotBytes)
	if err != nil || n != 0 || plain != nil {
		t.Fatalf("symlink n=%d err=%v", n, err)
	}
}

func TestPackTokens_CapsSize(t *testing.T) {
	data := t.TempDir()
	writeToken(t, data, ".strava/tokens.json", "0123456789abcdef")
	if _, _, err := packTokens(data, 8); !errors.Is(err, errTokenSize) {
		t.Fatalf("%v", err)
	}
}

func TestUnpackTokens_RejectsPaths(t *testing.T) {
	cases := []string{
		"../outside",
		"/etc/passwd",
		"//etc/passwd",
		"foo/../../etc/passwd",
		"./../../x",
		`foo\..\x`,
		"foo/../../../tmp/x",
	}
	for _, name := range cases {
		t.Run(name, func(t *testing.T) {
			data := t.TempDir()
			plain := tarBytes(t, []tarEnt{{name: name, body: "nope"}})
			if _, err := unpackTokens(data, plain, maxSnapshotBytes); !errors.Is(err, errTokenPath) {
				t.Fatalf("%v", err)
			}
			entries, err := os.ReadDir(data)
			if err != nil {
				t.Fatal(err)
			}
			if len(entries) != 0 {
				t.Fatalf("wrote %d entries", len(entries))
			}
		})
	}
}

func TestUnpackTokens_RejectsSymlinkAndPartial(t *testing.T) {
	data := t.TempDir()
	plain := tarBytes(t, []tarEnt{{name: "ok.txt", body: "yes"}, {typ: tar.TypeSymlink, name: "link", link: "../out"}})
	if _, err := unpackTokens(data, plain, maxSnapshotBytes); !errors.Is(err, errTokenPath) {
		t.Fatalf("%v", err)
	}
	if _, err := os.Stat(filepath.Join(data, "ok.txt")); !os.IsNotExist(err) {
		t.Fatalf("partial write: %v", err)
	}
}

func TestUnpackTokens_AllowsRelative(t *testing.T) {
	data := t.TempDir()
	plain := tarBytes(t, []tarEnt{
		{typ: tar.TypeDir, name: "sub"},
		{name: "./.strava/tokens.json", body: "ok"},
	})
	n, err := unpackTokens(data, plain, maxSnapshotBytes)
	if err != nil || n != 1 {
		t.Fatalf("n=%d %v", n, err)
	}
	body, err := os.ReadFile(filepath.Join(data, ".strava", "tokens.json"))
	if err != nil || string(body) != "ok" {
		t.Fatalf("%q %v", body, err)
	}
}

func TestUnpackTokens_CapsSize(t *testing.T) {
	data := t.TempDir()
	plain := tarBytes(t, []tarEnt{{name: "a.txt", body: "0123456789"}})
	if _, err := unpackTokens(data, plain, 4); !errors.Is(err, errTokenSize) {
		t.Fatalf("%v", err)
	}
	entries, err := os.ReadDir(data)
	if err != nil || len(entries) != 0 {
		t.Fatalf("entries %d %v", len(entries), err)
	}
}

func TestSafeTokenPath(t *testing.T) {
	dir := t.TempDir()
	for _, name := range []string{"", ".", "..", "../", "../x", "/abs", "a/../../b", `a\b`, "C:/windows"} {
		if _, err := safeTokenPath(dir, name); !errors.Is(err, errTokenPath) {
			t.Fatalf("%q: %v", name, err)
		}
	}
	got, err := safeTokenPath(dir, ".strava/tokens.json")
	if err != nil {
		t.Fatal(err)
	}
	if !stringsHasPrefixPath(got, dir) {
		t.Fatalf("%s", got)
	}
}

func TestEncryptTokens_RoundTrip(t *testing.T) {
	key := bytes.Repeat([]byte{9}, 32)
	for _, plain := range [][]byte{[]byte("refresh-token"), {}, []byte("a")} {
		a, err := EncryptTokens(key, plain)
		if err != nil {
			t.Fatal(err)
		}
		b, err := EncryptTokens(key, plain)
		if err != nil {
			t.Fatal(err)
		}
		if bytes.Equal(a, b) {
			t.Fatal("nonce reused")
		}
		if len(a) != tokenNonceLen+len(plain)+tokenTagLen {
			t.Fatalf("len %d", len(a))
		}
		if len(plain) >= 8 && bytes.Contains(a, plain) {
			t.Fatal("plaintext in ciphertext")
		}
		got, err := DecryptTokens(key, a)
		if err != nil || !bytes.Equal(got, plain) {
			t.Fatalf("%q %v", got, err)
		}
	}
}

func TestDecryptTokens_WrongKey(t *testing.T) {
	key := bytes.Repeat([]byte{9}, 32)
	other := bytes.Repeat([]byte{8}, 32)
	blob, err := EncryptTokens(key, []byte("secret"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := DecryptTokens(other, blob); !errors.Is(err, errTokenDecrypt) {
		t.Fatalf("wrong key %v", err)
	}
	flipped := append([]byte(nil), blob...)
	flipped[len(flipped)-1] ^= 1
	if _, err := DecryptTokens(key, flipped); !errors.Is(err, errTokenDecrypt) {
		t.Fatalf("tamper %v", err)
	}
	if _, err := DecryptTokens(key[:31], blob); !errors.Is(err, errTokenKey) {
		t.Fatalf("short key %v", err)
	}
	if _, err := EncryptTokens(key[:16], []byte("x")); !errors.Is(err, errTokenKey) {
		t.Fatalf("encrypt short %v", err)
	}
	if _, err := DecryptTokens(key, []byte{1, 2, 3}); !errors.Is(err, errTokenDecrypt) {
		t.Fatalf("short blob %v", err)
	}
	if decodeSnapshotKey("") != nil || decodeSnapshotKey("%%%") != nil || decodeSnapshotKey("YQ==") != nil {
		t.Fatal("bad key decoded")
	}
}

func sameStrings(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func stringsHasPrefixPath(path, root string) bool {
	sep := string(filepath.Separator)
	return len(path) > len(root) && path[:len(root)] == root && path[len(root):len(root)+1] == sep
}
