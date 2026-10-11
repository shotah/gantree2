package main

import (
	"context"
	"fmt"
	"log/slog"
	"path/filepath"
	"time"

	"github.com/shotah/ai-gantry/internal/channel"
	"github.com/shotah/ai-gantry/internal/channel/chat"
	"github.com/shotah/ai-gantry/internal/config"
	"github.com/shotah/ai-gantry/internal/mcp"
	"github.com/shotah/ai-gantry/internal/snapshot"
)

// doBoot is the Agent DO bridge for one process. Nil unless SNAPSHOT=true.
type doBoot struct {
	snap *snapshot.Runner
	sock chat.Socket
}

// prepareSnapshot reads a config frame (chat channel only), writes persona and
// mcp.toml, and downloads gantry.db, SELF.md, and the token archive before
// those stores open.
//
// On error the returned boot has snap nil and keeps the handshake socket
// open, so run can push the boot log to the DO before it exits. The
// caller owns that Close.
func prepareSnapshot(cfg *config.Config, logger *slog.Logger) (*doBoot, error) {
	if cfg == nil {
		return nil, nil
	}
	if logger == nil {
		logger = slog.Default()
	}
	boot := &doBoot{}
	get := snapshot.URLs{DB: cfg.SnapshotGetDB, Self: cfg.SnapshotGetSelf, Tokens: cfg.SnapshotGetTokens}
	put := snapshot.URLs{DB: cfg.SnapshotPutDB, Self: cfg.SnapshotPutSelf, Tokens: cfg.SnapshotPutTokens}
	if config.IsChatChannel(cfg.Channel) {
		hctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		sock, frame, err := chat.Handshake(hctx, cfg.PendantMailboxURL, cfg.PendantBearer)
		cancel()
		if err != nil {
			logger.Warn("snapshot: no config frame; continuing", "err", err)
		} else {
			boot.sock = sock
			if err := applyConfigFrame(cfg, frame); err != nil {
				return boot, err
			}
			if frame.Restore.DB != "" {
				get.DB = frame.Restore.DB
			}
			if frame.Restore.Self != "" {
				get.Self = frame.Restore.Self
			}
			if frame.Put.DB != "" {
				put.DB = frame.Put.DB
			}
			if frame.Put.Self != "" {
				put.Self = frame.Put.Self
			}
			if frame.Restore.Tokens != "" {
				get.Tokens = frame.Restore.Tokens
			}
			if frame.Put.Tokens != "" {
				put.Tokens = frame.Put.Tokens
			}
		}
	}
	boot.snap = snapshot.New(snapshot.Options{
		DataDir:    cfg.DataDir,
		PersonaDir: cfg.PersonaDir,
		Interval:   cfg.SnapshotInterval,
		Get:        get,
		Put:        put,
		Key:        cfg.SnapshotKey,
	})
	rctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	res, err := boot.snap.Restore(rctx)
	if err != nil {
		// A half-restored brain must not be published over the good one.
		boot.snap = nil
		return boot, err
	}
	if res.Files > 0 {
		logger.Info("snapshot restored", "files", res.Files)
	}
	return boot, nil
}

func applyConfigFrame(cfg *config.Config, frame chat.ConfigFrame) error {
	if len(frame.Env) > 0 {
		prevInterval := cfg.SnapshotInterval
		prevSnap := cfg.Snapshot
		next, err := config.ApplyEnv(frame.Env)
		if err != nil {
			return err
		}
		if _, ok := frame.Env["SNAPSHOT"]; !ok {
			next.Snapshot = prevSnap
		}
		if _, ok := frame.Env["SNAPSHOT_INTERVAL"]; !ok {
			next.SnapshotInterval = prevInterval
		}
		*cfg = *next
	}
	if err := snapshot.Place(filepath.Join(cfg.PersonaDir, "PERSONA.md"), frame.Persona); err != nil {
		return fmt.Errorf("config frame: persona (PERSONA_DIR=%s): %w", cfg.PersonaDir, err)
	}
	if err := snapshot.Place(cfg.MCPManifest, frame.MCP); err != nil {
		return fmt.Errorf("config frame: mcp (MCP_MANIFEST=%s): %w", cfg.MCPManifest, err)
	}
	return nil
}

func statusFrame(host *mcp.Host) chat.StatusFrame {
	f := chat.StatusFrame{
		Kind:      chat.KindStatus,
		Published: []string{},
		Skipped:   []chat.SkippedMCP{},
	}
	if host == nil {
		return f
	}
	for _, s := range host.ServerHealth() {
		if s.State == mcp.ServerSkipped {
			f.Skipped = append(f.Skipped, chat.SkippedMCP{
				Name:   s.Name,
				Reason: string(s.Reason),
			})
			continue
		}
		f.Published = append(f.Published, s.Name)
	}
	return f
}

func wireDO(p *chat.Channel, boot *doBoot, bridge *chat.LogBridge, host *mcp.Host) {
	if p == nil {
		return
	}
	if boot != nil && boot.sock != nil {
		p.Adopt(boot.sock)
		boot.sock = nil
	}
	if boot != nil && boot.snap != nil {
		p.SetOnConfig(func(frame chat.ConfigFrame) {
			boot.snap.SetPut(snapshot.URLs{DB: frame.Put.DB, Self: frame.Put.Self, Tokens: frame.Put.Tokens})
		})
		p.SetStatus(func() chat.StatusFrame { return statusFrame(host) })
	}
	if bridge != nil {
		bridge.SetSend(func(raw []byte) {
			sctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			_ = p.SendDO(sctx, raw)
		})
	}
}

func startSnapshotLoop(ctx context.Context, boot *doBoot, logger *slog.Logger, mouth channel.Channel) {
	if boot == nil || boot.snap == nil {
		return
	}
	go boot.snap.Loop(ctx, func(res snapshot.Result, err error) {
		if err != nil {
			logger.Warn("snapshot put failed", "err", err)
			return
		}
		sendSnapshotFrame(logger, mouth, res)
	})
}

// emitSnapshot is the SIGTERM publish: Run has returned, the store is closed,
// then this PUTs and best-effort writes a snapshot frame.
func emitSnapshot(logger *slog.Logger, snap *snapshot.Runner, mouth channel.Channel) {
	if snap == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	res, err := snap.Publish(ctx)
	if err != nil {
		logger.Error("snapshot put failed", "err", err)
		return
	}
	sendSnapshotFrame(logger, mouth, res)
}

func sendSnapshotFrame(logger *slog.Logger, mouth channel.Channel, res snapshot.Result) {
	if res.Files == 0 {
		return
	}
	logger.Info("snapshot put", "stamp", res.Stamp, "bytes", res.Bytes)
	raw, err := chat.EncodeSnapshot(chat.SnapshotFrame{
		Kind:  chat.KindSnapshot,
		Stamp: res.Stamp,
		Bytes: res.Bytes,
	})
	if err != nil {
		logger.Warn("snapshot frame encode failed", "err", err)
		return
	}
	p, ok := mouth.(*chat.Channel)
	if !ok || p == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if err := p.SendDO(ctx, raw); err != nil {
		logger.Warn("snapshot frame failed", "err", err)
	}
}
