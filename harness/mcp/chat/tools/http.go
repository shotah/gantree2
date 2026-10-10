package tools

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

type roundTrip func(*http.Request) (*http.Response, error)

var httpDo roundTrip = defaultHTTPDo

var httpClient = &http.Client{Timeout: HTTPTimeoutSec * time.Second}

func defaultHTTPDo(req *http.Request) (*http.Response, error) {
	return httpClient.Do(req)
}

type blobWriteResult struct {
	Rev   int64  `json:"rev"`
	Bytes int    `json:"bytes"`
	Edge  int    `json:"edge"`
	MIME  string `json:"mime"`
	Path  string `json:"path,omitempty"`
}

type httpResult struct {
	Status int
	Header http.Header
	Body   []byte
}

func pendantRequest(ctx context.Context, cfg serverConfig, method, url string, body []byte, contentType string) (httpResult, error) {
	var rdr io.Reader
	if body != nil {
		rdr = bytes.NewReader(body)
	}
	req, err := http.NewRequestWithContext(ctx, method, url, rdr)
	if err != nil {
		return httpResult{}, err
	}
	req.Header.Set("Authorization", "Bearer "+cfg.Bearer)
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	resp, err := httpDo(req)
	if err != nil {
		return httpResult{}, errors.New("pendant request failed")
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, BackdropMaxBytes+64*1024))
	if err != nil {
		return httpResult{}, errors.New("pendant response failed")
	}
	return httpResult{Status: resp.StatusCode, Header: resp.Header, Body: raw}, nil
}

func workerError(raw []byte, status int) string {
	var wrap struct {
		Error  string `json:"error"`
		Detail string `json:"detail"`
	}
	if err := json.Unmarshal(raw, &wrap); err == nil {
		if wrap.Error != "" {
			return wrap.Error
		}
		if wrap.Detail != "" {
			return wrap.Detail
		}
	}
	text := strings.TrimSpace(string(raw))
	if text == "" {
		return fmt.Sprintf("HTTP %d", status)
	}
	return text
}

func parseWriteJSON(raw []byte) (int64, error) {
	var wrap struct {
		OK    bool   `json:"ok"`
		Rev   int64  `json:"rev"`
		Error string `json:"error"`
	}
	if err := json.Unmarshal(raw, &wrap); err != nil {
		return 0, errors.New(strings.TrimSpace(string(raw)))
	}
	if wrap.Error != "" {
		return 0, errors.New(wrap.Error)
	}
	return wrap.Rev, nil
}
