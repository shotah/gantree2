package pendant

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"github.com/gorilla/websocket"
)

// handshakeWait is how long Dial waits for the DO's config frame when the
// caller did not set a deadline.
const handshakeWait = 30 * time.Second

// Socket is an open mailbox connection. Handshake returns one so boot can
// keep it and the chat session can adopt it instead of dialing twice.
type Socket interface {
	ReadMessage() (int, []byte, error)
	WriteMessage(messageType int, data []byte) error
	Close() error
}

// Handshake dials the mailbox and reads until a config frame.
// Frames before that config are discarded — the DO should send config first.
// The returned socket stays open, with no read deadline, for Channel.Adopt.
func Handshake(ctx context.Context, mailbox, bearer string) (Socket, ConfigFrame, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	if _, ok := ctx.Deadline(); !ok {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, handshakeWait)
		defer cancel()
	}
	ws, _, err := normalizeMailbox(mailbox)
	if err != nil {
		return nil, ConfigFrame{}, err
	}
	header := http.Header{}
	header.Set("Authorization", "Bearer "+bearer)
	cn, err := defaultDial(ctx, ws, header)
	if err != nil {
		return nil, ConfigFrame{}, err
	}
	deadline, _ := ctx.Deadline()
	setReadDeadline(cn, deadline)
	for {
		if err := ctx.Err(); err != nil {
			_ = cn.Close()
			return nil, ConfigFrame{}, err
		}
		_, raw, err := cn.ReadMessage()
		if err != nil {
			_ = cn.Close()
			return nil, ConfigFrame{}, fmt.Errorf("pendant: config frame: %w", err)
		}
		kind, err := KindOf(raw)
		if err != nil || kind != KindConfig {
			continue
		}
		frame, err := DecodeConfig(raw)
		if err != nil {
			_ = cn.Close()
			return nil, ConfigFrame{}, err
		}
		setReadDeadline(cn, time.Time{})
		return cn, frame, nil
	}
}

func setReadDeadline(cn conn, at time.Time) {
	d, ok := cn.(interface{ SetReadDeadline(time.Time) error })
	if !ok {
		return
	}
	_ = d.SetReadDeadline(at)
}

// Adopt keeps s for the next serve instead of dialing again.
// The channel closes it when that serve ends.
func (c *Channel) Adopt(s Socket) {
	if c == nil || s == nil {
		return
	}
	c.mu.Lock()
	if c.pending != nil {
		_ = c.pending.Close()
	}
	c.pending = s
	c.mu.Unlock()
}

func (c *Channel) takePending() conn {
	c.mu.Lock()
	defer c.mu.Unlock()
	cn := c.pending
	c.pending = nil
	return cn
}

// SetOnConfig receives each config frame on the live socket.
// A nil fn clears it. The callback must not block on the channel.
func (c *Channel) SetOnConfig(fn func(ConfigFrame)) {
	if c == nil {
		return
	}
	c.mu.Lock()
	c.onConfig = fn
	c.mu.Unlock()
}

// SetStatus, when set, is sent once after allow on each connection.
// A nil fn sends nothing (today's pendant wire).
func (c *Channel) SetStatus(fn func() StatusFrame) {
	if c == nil {
		return
	}
	c.mu.Lock()
	c.status = fn
	c.mu.Unlock()
}

// SendDO writes a raw frame on the live socket, or dials once when that
// socket is already gone (SIGTERM, after Run has returned).
func (c *Channel) SendDO(ctx context.Context, raw []byte) error {
	if c == nil || len(raw) == 0 {
		return nil
	}
	if live := c.getLive(); live != nil {
		if err := c.writeRaw(live, raw); err == nil {
			return nil
		}
	}
	header := http.Header{}
	header.Set("Authorization", "Bearer "+c.bearer)
	cn, err := c.dial(ctx, c.mailbox, header)
	if err != nil {
		return err
	}
	defer func() { _ = cn.Close() }()
	return cn.WriteMessage(websocket.TextMessage, raw)
}

func (c *Channel) writeStatus(cn conn) error {
	if c == nil || cn == nil {
		return nil
	}
	c.mu.Lock()
	fn := c.status
	c.mu.Unlock()
	if fn == nil {
		return nil
	}
	raw, err := EncodeStatus(fn())
	if err != nil {
		return err
	}
	return c.writeRaw(cn, raw)
}

func (c *Channel) writeRaw(cn conn, raw []byte) error {
	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	return cn.WriteMessage(websocket.TextMessage, raw)
}
