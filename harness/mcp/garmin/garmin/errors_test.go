// errors_test.go
package garmin

import (
	"encoding/json"
	"errors"
	"net/http"
	"testing"
)

func TestAPIError(t *testing.T) {
	err := &APIError{
		StatusCode: 404,
		Status:     "404 Not Found",
		Endpoint:   "/wellness-service/wellness/dailySleep",
		Message:    "No data found",
	}

	if err.Error() != "garmin: 404 Not Found /wellness-service/wellness/dailySleep: No data found" {
		t.Errorf("unexpected error message: %s", err.Error())
	}

	if !IsNotFound(err) {
		t.Error("expected IsNotFound to return true")
	}
	if IsRateLimited(err) {
		t.Error("expected IsRateLimited to return false")
	}
}

func TestAPIError_ErrorBranches(t *testing.T) {
	withBody := &APIError{
		Status: "500 Internal Server Error",
		Body:   json.RawMessage(`{"error":"boom"}`),
	}
	if got := withBody.Error(); got != `garmin: 500 Internal Server Error: {"error":"boom"}` {
		t.Errorf("body branch = %q", got)
	}

	statusOnly := &APIError{Status: "418 I'm a teapot"}
	if got := statusOnly.Error(); got != "garmin: 418 I'm a teapot" {
		t.Errorf("status-only branch = %q", got)
	}
}

func TestErrorClassifiers(t *testing.T) {
	auth401 := &APIError{StatusCode: http.StatusUnauthorized}
	auth403 := &APIError{StatusCode: http.StatusForbidden}
	rate429 := &APIError{StatusCode: http.StatusTooManyRequests}
	server500 := &APIError{StatusCode: http.StatusInternalServerError}
	notFound404 := &APIError{StatusCode: http.StatusNotFound}

	if !IsAuthError(auth401) || !IsAuthError(auth403) {
		t.Error("IsAuthError should match 401/403")
	}
	if !IsAuthError(ErrNotAuthenticated) || !IsAuthError(ErrSessionExpired) {
		t.Error("IsAuthError should match sentinel auth errors")
	}
	if IsAuthError(notFound404) {
		t.Error("IsAuthError should not match 404")
	}

	if !IsServerError(server500) {
		t.Error("IsServerError should match 500")
	}
	if IsServerError(notFound404) {
		t.Error("IsServerError should not match 404")
	}

	if !IsRetryable(rate429) || !IsRetryable(server500) {
		t.Error("IsRetryable should match 429 and 5xx")
	}
	if IsRetryable(notFound404) {
		t.Error("IsRetryable should not match 404")
	}

	if !IsRateLimited(rate429) || !IsRateLimited(ErrRateLimited) {
		t.Error("IsRateLimited should match 429 and sentinel")
	}
	if !IsNotFound(ErrNotFound) {
		t.Error("IsNotFound should match sentinel")
	}
}

func TestSentinelErrors(t *testing.T) {
	if !errors.Is(ErrNotAuthenticated, ErrNotAuthenticated) {
		t.Error("sentinel error identity failed")
	}
}
