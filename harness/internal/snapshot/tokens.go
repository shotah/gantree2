package snapshot

import (
	"archive/tar"
	"bytes"
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"io"
	"log/slog"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

const (
	tokenNonceLen     = 12
	tokenTagLen       = 16
	tokenSealOverhead = tokenNonceLen + tokenTagLen
	oauthPendingFile  = "oauth_pending.json"
)

var (
	errTokenPath    = errors.New("snapshot: tokens: rejected path")
	errTokenSize    = errors.New("snapshot: tokens exceed limit")
	errTokenDecrypt = errors.New("snapshot: tokens: decrypt")
	errTokenKey     = errors.New("snapshot: tokens: key")
	errTokenRead    = errors.New("snapshot: tokens: read")
	errTokenWrite   = errors.New("snapshot: tokens: write")
	errTokenTar     = errors.New("snapshot: tokens: tar")
)

// tokenAllow is the OAuth set under DATA_DIR. A directory contributes the
// regular files in that directory only (not subdirectories, not
// oauth_pending.json). A missing path is normal and is left out. When
// nothing matches, publish skips the PUT — it does not upload an empty tar.
//
//	.google_workspace_mcp/credentials/   Google Workspace credential files
//	.strava/tokens.json                  Strava refresh token
//	.config/ghealth/tokens.json          Google Health refresh token
//	.config/garmin/session.json          Garmin session (refresh token)
var tokenAllow = []tokenSpec{
	{rel: ".google_workspace_mcp/credentials", dir: true},
	{rel: ".strava/tokens.json"},
	{rel: ".config/ghealth/tokens.json"},
	{rel: ".config/garmin/session.json"},
}

type tokenSpec struct {
	rel string
	dir bool
}

type tokenFile struct {
	rel string
	abs string
}

// EncryptTokens seals plain with AES-256-GCM. The result is a random 12-byte
// nonce followed by the ciphertext and tag. key must be 32 bytes.
func EncryptTokens(key, plain []byte) ([]byte, error) {
	if len(key) != 32 {
		return nil, errTokenKey
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, errTokenKey
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil || gcm.NonceSize() != tokenNonceLen {
		return nil, errTokenKey
	}
	nonce := make([]byte, tokenNonceLen)
	if _, err := rand.Read(nonce); err != nil {
		return nil, errTokenKey
	}
	sealed := gcm.Seal(nil, nonce, plain, nil)
	out := make([]byte, 0, len(nonce)+len(sealed))
	out = append(out, nonce...)
	out = append(out, sealed...)
	return out, nil
}

// DecryptTokens opens a blob from EncryptTokens. A wrong key or a short
// blob returns an error and no plaintext.
func DecryptTokens(key, blob []byte) ([]byte, error) {
	if len(key) != 32 {
		return nil, errTokenKey
	}
	if len(blob) < tokenNonceLen+tokenTagLen {
		return nil, errTokenDecrypt
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, errTokenKey
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, errTokenDecrypt
	}
	plain, err := gcm.Open(nil, blob[:tokenNonceLen], blob[tokenNonceLen:], nil)
	if err != nil {
		return nil, errTokenDecrypt
	}
	return plain, nil
}

func decodeSnapshotKey(b64 string) []byte {
	raw, err := base64.StdEncoding.DecodeString(strings.TrimSpace(b64))
	if err != nil || len(raw) != 32 {
		return nil
	}
	return raw
}

func (r *Runner) skipTokensNoKey() {
	r.noKey.Do(func() {
		slog.Warn("snapshot: tokens skipped, no key")
	})
}

func (r *Runner) restoreTokens(ctx context.Context, rawURL, dataDir string) (bool, error) {
	if strings.TrimSpace(rawURL) == "" {
		return false, nil
	}
	if len(r.key) != 32 {
		r.skipTokensNoKey()
		return false, nil
	}
	body, ok, err := r.fetchBytes(ctx, rawURL, "tokens_tar")
	if err != nil || !ok {
		return false, err
	}
	plain, err := DecryptTokens(r.key, body)
	if err != nil {
		return false, err
	}
	n, err := unpackTokens(dataDir, plain, maxSnapshotBytes)
	if err != nil {
		return false, err
	}
	return n > 0, nil
}

func (r *Runner) publishTokens(ctx context.Context, rawURL, dataDir string) (int64, error) {
	if strings.TrimSpace(rawURL) == "" {
		return 0, nil
	}
	plain, n, err := packTokens(dataDir, maxSnapshotBytes-tokenSealOverhead)
	if err != nil {
		return 0, err
	}
	if n == 0 {
		return 0, nil
	}
	if len(r.key) != 32 {
		r.skipTokensNoKey()
		return 0, nil
	}
	sealed, err := EncryptTokens(r.key, plain)
	if err != nil {
		return 0, err
	}
	if int64(len(sealed)) > maxSnapshotBytes {
		return 0, errTokenSize
	}
	return r.putFile(ctx, rawURL, sealed)
}

func packTokens(dataDir string, maxPlain int64) ([]byte, int, error) {
	files, err := collectTokenFiles(dataDir)
	if err != nil {
		return nil, 0, err
	}
	if len(files) == 0 {
		return nil, 0, nil
	}
	var buf bytes.Buffer
	tw := tar.NewWriter(&buf)
	var total int64
	for _, f := range files {
		st, err := os.Lstat(f.abs)
		if err != nil || !st.Mode().IsRegular() {
			return nil, 0, errTokenRead
		}
		if st.Size() < 0 || st.Size() > maxPlain || total+st.Size() > maxPlain {
			return nil, 0, errTokenSize
		}
		body, err := os.ReadFile(f.abs)
		if err != nil {
			return nil, 0, errTokenRead
		}
		if int64(len(body)) > maxPlain || total+int64(len(body)) > maxPlain {
			return nil, 0, errTokenSize
		}
		total += int64(len(body))
		hdr := &tar.Header{
			Name:     f.rel,
			Mode:     0o600,
			Size:     int64(len(body)),
			Typeflag: tar.TypeReg,
			Format:   tar.FormatPAX,
			ModTime:  time.Unix(0, 0).UTC(),
		}
		if err := tw.WriteHeader(hdr); err != nil {
			return nil, 0, errTokenTar
		}
		if _, err := tw.Write(body); err != nil {
			return nil, 0, errTokenTar
		}
		if int64(buf.Len()) > maxPlain {
			return nil, 0, errTokenSize
		}
	}
	if err := tw.Close(); err != nil {
		return nil, 0, errTokenTar
	}
	if int64(buf.Len()) > maxPlain {
		return nil, 0, errTokenSize
	}
	return buf.Bytes(), len(files), nil
}

func unpackTokens(dataDir string, plain []byte, max int64) (int, error) {
	if max < 0 || int64(len(plain)) > max {
		return 0, errTokenSize
	}
	tr := tar.NewReader(bytes.NewReader(plain))
	type item struct {
		dest string
		body []byte
	}
	var items []item
	var total int64
	for {
		hdr, err := tr.Next()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return 0, errTokenTar
		}
		if hdr.Typeflag == tar.TypeDir {
			continue
		}
		if hdr.Typeflag != tar.TypeReg && hdr.Typeflag != tar.TypeRegA {
			return 0, errTokenPath
		}
		dest, err := safeTokenPath(dataDir, hdr.Name)
		if err != nil {
			return 0, err
		}
		if hdr.Size < 0 || hdr.Size > max || total > max-hdr.Size {
			return 0, errTokenSize
		}
		body := make([]byte, hdr.Size)
		if _, err := io.ReadFull(tr, body); err != nil {
			return 0, errTokenTar
		}
		total += hdr.Size
		items = append(items, item{dest: dest, body: body})
	}
	for _, it := range items {
		if err := writeAtomic(it.dest, it.body); err != nil {
			return 0, errTokenWrite
		}
		if err := os.Chmod(it.dest, 0o600); err != nil {
			return 0, errTokenWrite
		}
	}
	return len(items), nil
}

func collectTokenFiles(dataDir string) ([]tokenFile, error) {
	var out []tokenFile
	for _, spec := range tokenAllow {
		abs := filepath.Join(dataDir, filepath.FromSlash(spec.rel))
		info, err := os.Lstat(abs)
		if err != nil {
			if os.IsNotExist(err) {
				continue
			}
			return nil, errTokenRead
		}
		if spec.dir {
			files, err := collectTokenDir(abs, spec.rel)
			if err != nil {
				return nil, err
			}
			out = append(out, files...)
			continue
		}
		if !info.Mode().IsRegular() {
			continue
		}
		out = append(out, tokenFile{rel: spec.rel, abs: abs})
	}
	return out, nil
}

func collectTokenDir(abs, rel string) ([]tokenFile, error) {
	info, err := os.Lstat(abs)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, errTokenRead
	}
	if !info.IsDir() {
		return nil, nil
	}
	entries, err := os.ReadDir(abs)
	if err != nil {
		return nil, errTokenRead
	}
	names := make([]string, 0, len(entries))
	for _, e := range entries {
		if !tokenNameOK(e.Name()) || !e.Type().IsRegular() {
			continue
		}
		names = append(names, e.Name())
	}
	sort.Strings(names)
	out := make([]tokenFile, 0, len(names))
	for _, name := range names {
		childAbs := filepath.Join(abs, name)
		st, err := os.Lstat(childAbs)
		if err != nil || !st.Mode().IsRegular() {
			continue
		}
		out = append(out, tokenFile{rel: path.Join(rel, name), abs: childAbs})
	}
	return out, nil
}

func tokenNameOK(name string) bool {
	if name == "" || name == "." || name == ".." || name == oauthPendingFile {
		return false
	}
	return !strings.ContainsAny(name, `/\`)
}

func safeTokenPath(dataDir, name string) (string, error) {
	if name == "" || strings.Contains(name, `\`) || strings.Contains(name, "\x00") || strings.Contains(name, ":") {
		return "", errTokenPath
	}
	if strings.HasPrefix(name, "/") {
		return "", errTokenPath
	}
	cleaned := path.Clean(name)
	if cleaned == "." || cleaned == ".." || strings.HasPrefix(cleaned, "../") || strings.HasPrefix(cleaned, "/") {
		return "", errTokenPath
	}
	root := filepath.Clean(dataDir)
	dest := filepath.Join(root, filepath.FromSlash(cleaned))
	rel, err := filepath.Rel(root, dest)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return "", errTokenPath
	}
	return dest, nil
}
