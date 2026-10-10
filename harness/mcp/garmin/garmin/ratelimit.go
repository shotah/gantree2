// ratelimit.go
package garmin

import (
	"context"
	"time"

	"golang.org/x/time/rate"
)

type RateLimitConfig struct {
	RequestsPerMinute int
	BurstSize         int
}

func DefaultRateLimitConfig() RateLimitConfig {
	// Client-side courtesy throttle (Garmin's limits are undocumented).
	// ~30/min sustained with a small burst keeps MCP snappy without hammering Connect.
	return RateLimitConfig{
		RequestsPerMinute: 30,
		BurstSize:         8,
	}
}

type rateLimiter struct {
	limiter *rate.Limiter
}

func newRateLimiter(cfg RateLimitConfig) *rateLimiter {
	limit := rate.Every(time.Minute / time.Duration(cfg.RequestsPerMinute))
	return &rateLimiter{
		limiter: rate.NewLimiter(limit, cfg.BurstSize),
	}
}

func (r *rateLimiter) Wait(ctx context.Context) error {
	return r.limiter.Wait(ctx)
}
