// Command garmin-auth interactively authenticates with Garmin Connect and
// writes a reusable session to settings.json at the module root.
//
// Usage:
//
//	make auth
//	go run ./cmd/garmin-auth
//
// After auth succeeds, record fixtures without logging in again:
//
//	make fixtures
package main

import (
	"bufio"
	"context"
	"fmt"
	"os"
	"strings"

	"github.com/shotah/go-garmin/garmin"
	"github.com/shotah/go-garmin/testutil"
	"golang.org/x/term"
)

func main() {
	reader := bufio.NewReader(os.Stdin)

	fmt.Fprint(os.Stderr, "Email: ")
	line, err := reader.ReadString('\n')
	if err != nil {
		fatalf("read email: %v", err)
	}
	email := strings.TrimSpace(line)
	if email == "" {
		fatalf("email is required")
	}

	fmt.Fprint(os.Stderr, "Password: ")
	passwordBytes, err := term.ReadPassword(int(os.Stdin.Fd()))
	fmt.Fprintln(os.Stderr)
	if err != nil {
		fatalf("read password: %v", err)
	}
	password := string(passwordBytes)
	if password == "" {
		fatalf("password is required")
	}

	client := garmin.New(garmin.Options{
		MFAHandler: func() (string, error) {
			fmt.Fprint(os.Stderr, "MFA Code: ")
			code, err := reader.ReadString('\n')
			if err != nil {
				return "", fmt.Errorf("read MFA code: %w", err)
			}
			return strings.TrimSpace(code), nil
		},
	})

	fmt.Fprintln(os.Stderr, "Authenticating with Garmin Connect...")
	if err := client.Login(context.Background(), email, password); err != nil {
		fatalf("login failed: %v", err)
	}

	path := testutil.SettingsPath()
	if err := saveSettings(client, path); err != nil {
		fatalf("save settings: %v", err)
	}

	client.SetSessionPersister(func(c *garmin.Client) error {
		return saveSettings(c, path)
	})

	fmt.Fprintf(os.Stderr, "Saved session to %s\n", path)
	fmt.Fprintln(os.Stderr, "Next: make fixtures")
}

func saveSettings(client *garmin.Client, path string) error {
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o600)
	if err != nil {
		return err
	}
	defer f.Close()
	return client.SaveSession(f)
}

func fatalf(format string, args ...any) {
	fmt.Fprintf(os.Stderr, "Error: "+format+"\n", args...)
	os.Exit(1)
}
