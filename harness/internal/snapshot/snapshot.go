// Package snapshot restores gantry.db and SELF.md from presigned GET URLs
// and PUTs them back on a timer and on process stop.
//
// It is off unless the caller constructs a Runner. An empty URL skips that
// file. A GET that answers 404 is a fresh brain, not an error.
package snapshot

import (
	"bytes"
	"context"
	"database/sql"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	_ "modernc.org/sqlite" // pure-Go SQLite; VACUUM INTO for a consistent gantry.db
)

const (
	// DBFile is the session store inside the data directory.
	DBFile = "gantry.db"
	// SelfFile is the agent-written persona note.
	SelfFile = "SELF.md"
)

// maxSnapshotBytes refuses a GET that would not fit in memory.
const maxSnapshotBytes = 256 << 20

// URLs are presigned R2 addresses. Empty skips that file.
type URLs struct {
	DB   string
	Self string
}

// Result is one publish. Files is how many bodies were uploaded.
// Stamp is UTC, compact, so the DO can name the object.
type Result struct {
	Stamp string
	Bytes int64
	Files int
}

// Options configures a Runner. Client nil uses a 60s timeout client.
type Options struct {
	DataDir    string
	PersonaDir string
	Interval   time.Duration
	Get        URLs
	Put        URLs
	Client     *http.Client
}

// Runner downloads and uploads the two brain files.
type Runner struct {
	dataDir    string
	personaDir string
	interval   time.Duration
	client     *http.Client

	mu  sync.Mutex
	get URLs
	put URLs
	pub sync.Mutex
}

// New returns a runner. It does not touch the network or the disk.
func New(opts Options) *Runner {
	c := opts.Client
	if c == nil {
		c = &http.Client{Timeout: 60 * time.Second}
	}
	return &Runner{
		dataDir:    opts.DataDir,
		personaDir: opts.PersonaDir,
		interval:   opts.Interval,
		client:     c,
		get:        opts.Get,
		put:        opts.Put,
	}
}

// SetPut replaces non-empty publish URLs. A later config frame calls this
// when the DO refreshes presigned PUTs. Empty fields keep the previous URL.
func (r *Runner) SetPut(u URLs) {
	if r == nil {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if u.DB != "" {
		r.put.DB = u.DB
	}
	if u.Self != "" {
		r.put.Self = u.Self
	}
}

// Restore writes gantry.db and SELF.md into the data directory when the GET
// URLs are set. SELF.md is also copied into the persona directory when that
// path is different, which is where the running agent reads it.
func (r *Runner) Restore(ctx context.Context) (Result, error) {
	if r == nil {
		return Result{}, nil
	}
	r.mu.Lock()
	get := r.get
	dataDir := r.dataDir
	personaDir := r.personaDir
	r.mu.Unlock()

	var res Result
	dbPath := filepath.Join(dataDir, DBFile)
	wroteDB, err := r.fetch(ctx, get.DB, dbPath)
	if err != nil {
		return Result{}, err
	}
	if wroteDB {
		res.Files++
	}
	selfPath := filepath.Join(dataDir, SelfFile)
	wroteSelf, err := r.fetch(ctx, get.Self, selfPath)
	if err != nil {
		return Result{}, err
	}
	if wroteSelf {
		res.Files++
		if err := copySelf(selfPath, personaDir, dataDir); err != nil {
			return Result{}, err
		}
	}
	return res, nil
}

// Publish uploads whichever files exist to the PUT URLs.
// A missing file is skipped. Nothing uploaded returns a zero Result.
func (r *Runner) Publish(ctx context.Context) (Result, error) {
	if r == nil {
		return Result{}, nil
	}
	r.pub.Lock()
	defer r.pub.Unlock()

	r.mu.Lock()
	put := r.put
	dataDir := r.dataDir
	personaDir := r.personaDir
	r.mu.Unlock()

	stamp := time.Now().UTC().Format("20060102T150405Z")
	var res Result
	dbBody, err := readDB(filepath.Join(dataDir, DBFile))
	if err != nil && !os.IsNotExist(err) {
		return Result{}, err
	}
	n, err := r.putFile(ctx, put.DB, dbBody)
	if err != nil {
		return Result{}, err
	}
	if n > 0 {
		res.Files++
		res.Bytes += n
	}
	selfBody, err := os.ReadFile(selfSource(dataDir, personaDir))
	if err != nil && !os.IsNotExist(err) {
		return Result{}, err
	}
	n, err = r.putFile(ctx, put.Self, selfBody)
	if err != nil {
		return Result{}, err
	}
	if n > 0 {
		res.Files++
		res.Bytes += n
	}
	if res.Files == 0 {
		return Result{}, nil
	}
	res.Stamp = stamp
	return res, nil
}

// Loop publishes each time interval elapses until ctx is cancelled.
// Interval zero waits for cancel and does not publish; the caller publishes
// once more on the way out (SIGTERM).
func (r *Runner) Loop(ctx context.Context, on func(Result, error)) {
	if r == nil || ctx == nil {
		return
	}
	var ticks <-chan time.Time
	if r.interval > 0 {
		t := time.NewTicker(r.interval)
		defer t.Stop()
		ticks = t.C
	}
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticks:
			res, err := r.Publish(context.Background())
			if on != nil {
				on(res, err)
			}
		}
	}
}

// Place writes body to path, creating parent directories. An empty body or
// path is a no-op so a config frame can omit persona or mcp.
func Place(path, body string) error {
	if strings.TrimSpace(path) == "" || body == "" {
		return nil
	}
	return writeAtomic(path, []byte(body))
}

func (r *Runner) fetch(ctx context.Context, rawURL, path string) (bool, error) {
	rawURL = strings.TrimSpace(rawURL)
	if rawURL == "" {
		return false, nil
	}
	if err := checkURL(rawURL); err != nil {
		return false, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return false, err
	}
	resp, err := r.client.Do(req)
	if err != nil {
		return false, fmt.Errorf("snapshot: get %s: %w", filepath.Base(path), err)
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusNotFound {
		return false, nil
	}
	if resp.StatusCode != http.StatusOK {
		return false, fmt.Errorf("snapshot: get %s: HTTP %d", filepath.Base(path), resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxSnapshotBytes+1))
	if err != nil {
		return false, fmt.Errorf("snapshot: get %s: %w", filepath.Base(path), err)
	}
	if int64(len(body)) > maxSnapshotBytes {
		return false, fmt.Errorf("snapshot: %s exceeds %d bytes", filepath.Base(path), maxSnapshotBytes)
	}
	if err := writeAtomic(path, body); err != nil {
		return false, err
	}
	return true, nil
}

func (r *Runner) putFile(ctx context.Context, rawURL string, body []byte) (int64, error) {
	rawURL = strings.TrimSpace(rawURL)
	if rawURL == "" || body == nil {
		return 0, nil
	}
	if err := checkURL(rawURL); err != nil {
		return 0, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPut, rawURL, bytes.NewReader(body))
	if err != nil {
		return 0, err
	}
	req.ContentLength = int64(len(body))
	req.Header.Set("Content-Type", "application/octet-stream")
	resp, err := r.client.Do(req)
	if err != nil {
		return 0, fmt.Errorf("snapshot: put: %w", err)
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, resp.Body)
	switch resp.StatusCode {
	case http.StatusOK, http.StatusCreated, http.StatusNoContent:
		return int64(len(body)), nil
	default:
		return 0, fmt.Errorf("snapshot: put: HTTP %d", resp.StatusCode)
	}
}

func checkURL(raw string) error {
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") {
		return fmt.Errorf("snapshot: presigned URL must be http(s)")
	}
	return nil
}

func copySelf(src, personaDir, dataDir string) error {
	if strings.TrimSpace(personaDir) == "" {
		return nil
	}
	if filepath.Clean(personaDir) == filepath.Clean(dataDir) {
		return nil
	}
	body, err := os.ReadFile(src)
	if err != nil {
		return err
	}
	return writeAtomic(filepath.Join(personaDir, SelfFile), body)
}

func selfSource(dataDir, personaDir string) string {
	if strings.TrimSpace(personaDir) != "" {
		p := filepath.Join(personaDir, SelfFile)
		if _, err := os.Stat(p); err == nil {
			return p
		}
	}
	return filepath.Join(dataDir, SelfFile)
}

func writeAtomic(path string, body []byte) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return fmt.Errorf("snapshot: mkdir: %w", err)
	}
	tmp, err := os.CreateTemp(filepath.Dir(path), ".snap-*")
	if err != nil {
		return fmt.Errorf("snapshot: temp: %w", err)
	}
	tmpName := tmp.Name()
	ok := false
	defer func() {
		if !ok {
			_ = os.Remove(tmpName)
		}
	}()
	if _, err := tmp.Write(body); err != nil {
		_ = tmp.Close()
		return fmt.Errorf("snapshot: write: %w", err)
	}
	if err := tmp.Close(); err != nil {
		return fmt.Errorf("snapshot: close: %w", err)
	}
	if err := os.Chmod(tmpName, 0o644); err != nil {
		return fmt.Errorf("snapshot: chmod: %w", err)
	}
	if err := os.Rename(tmpName, path); err != nil {
		return fmt.Errorf("snapshot: rename: %w", err)
	}
	ok = true
	return nil
}

func readDB(path string) ([]byte, error) {
	if _, err := os.Stat(path); err != nil {
		return nil, err
	}
	if !looksLikeSQLite(path) {
		return os.ReadFile(path)
	}
	tmp, err := os.CreateTemp("", "gantry-snap-*.db")
	if err != nil {
		return os.ReadFile(path)
	}
	tmpName := tmp.Name()
	_ = tmp.Close()
	// VACUUM INTO refuses an existing destination.
	_ = os.Remove(tmpName)
	defer func() {
		_ = os.Remove(tmpName)
		_ = os.Remove(tmpName + "-wal")
		_ = os.Remove(tmpName + "-shm")
	}()
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return os.ReadFile(path)
	}
	defer db.Close()
	esc := strings.ReplaceAll(tmpName, "'", "''")
	if _, err := db.Exec("VACUUM INTO '" + esc + "'"); err != nil {
		return os.ReadFile(path)
	}
	return os.ReadFile(tmpName)
}

func looksLikeSQLite(path string) bool {
	f, err := os.Open(path)
	if err != nil {
		return false
	}
	defer f.Close()
	buf := make([]byte, 16)
	n, _ := io.ReadFull(f, buf)
	return n >= 15 && string(buf[:15]) == "SQLite format 3"
}
