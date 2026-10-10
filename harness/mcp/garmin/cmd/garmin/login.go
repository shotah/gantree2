package main

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"os"
	"strings"

	"github.com/shotah/go-garmin/garmin"
	"github.com/spf13/cobra"
	"golang.org/x/term"
)

const authGuideURL = "https://github.com/shotah/ai-gantry/blob/main/docs/auth.md"

var loginCmd = &cobra.Command{
	Use:   "login",
	Short: "Authenticate with Garmin Connect",
	Long: `Interactively authenticate with Garmin Connect using email and password.

Chat / headless MFA paste (credentials from env, never from chat):
  garmin login url              # start login; may ask for MFA via /auth garmin <code>
  garmin login exchange <code>  # finish MFA → session.json

Env: GARMIN_EMAIL, GARMIN_PASSWORD (required for url/exchange).`,
	Args: cobra.ArbitraryArgs,
	RunE: runLogin,
}

var logoutCmd = &cobra.Command{
	Use:   "logout",
	Short: "Remove saved session",
	Long:  "Remove the saved Garmin Connect session from disk.",
	Args:  cobra.NoArgs,
	RunE:  runLogout,
}

func runLogin(_ *cobra.Command, args []string) error {
	if len(args) > 0 {
		switch args[0] {
		case "url":
			return runLoginURL()
		case "exchange":
			if len(args) < 2 {
				return errors.New("usage: garmin login exchange <mfa-code>")
			}
			return runLoginExchange(strings.Join(args[1:], " "))
		default:
			return fmt.Errorf("unknown login subcommand %q (want url|exchange, or no args for interactive)", args[0])
		}
	}
	return runLoginInteractive()
}

func runLoginInteractive() error {
	if client, err := loadClient(); err == nil {
		_ = client
		return errors.New("already logged in, use 'garmin logout' first")
	}

	reader := bufio.NewReader(os.Stdin)

	fmt.Fprint(os.Stderr, "Email: ")
	email, _ := reader.ReadString('\n')
	email = strings.TrimSpace(email)

	fmt.Fprint(os.Stderr, "Password: ")
	passwordBytes, err := term.ReadPassword(int(os.Stdin.Fd()))
	if err != nil {
		return fmt.Errorf("failed to read password: %w", err)
	}
	fmt.Fprintln(os.Stderr) // newline after password
	password := string(passwordBytes)

	client := garmin.New(garmin.Options{
		MFAHandler: func() (string, error) {
			fmt.Fprint(os.Stderr, "MFA Code: ")
			code, _ := reader.ReadString('\n')
			return strings.TrimSpace(code), nil
		},
	})

	ctx := context.Background()
	if err := client.Login(ctx, email, password); err != nil {
		return err
	}

	if err := saveClient(client); err != nil {
		return fmt.Errorf("login succeeded but failed to save session: %w", err)
	}
	fmt.Fprintln(os.Stderr, "Login successful.")
	return nil
}

func runLoginURL() error {
	email, password, err := garminCredsFromEnv()
	if err != nil {
		return err
	}
	pendingPath := garmin.MFAPendingPath(sessionPath())
	client := garmin.New(garmin.Options{})
	mfaRequired, mfaMethod, err := client.ChatLoginStart(context.Background(), email, password, pendingPath)
	if err != nil {
		return err
	}
	if mfaRequired {
		fmt.Printf("garmin: MFA required (%s) — check your email/app for the code\n", mfaMethod)
		fmt.Println("then paste the code: /auth garmin <code>")
		fmt.Println("guide: " + authGuideURL)
		return nil
	}
	if err := saveClient(client); err != nil {
		return fmt.Errorf("login succeeded but failed to save session: %w", err)
	}
	fmt.Printf("garmin: authorized ✓ (session → %s)\n", sessionPath())
	fmt.Println("guide: " + authGuideURL)
	return nil
}

func runLoginExchange(code string) error {
	pendingPath := garmin.MFAPendingPath(sessionPath())
	client := garmin.New(garmin.Options{})
	if err := client.ChatLoginExchange(context.Background(), pendingPath, code); err != nil {
		return err
	}
	if err := saveClient(client); err != nil {
		return fmt.Errorf("MFA succeeded but failed to save session: %w", err)
	}
	fmt.Printf("garmin: authorized ✓ (session → %s)\n", sessionPath())
	fmt.Println("guide: " + authGuideURL)
	return nil
}

func garminCredsFromEnv() (email, password string, err error) {
	email = strings.TrimSpace(os.Getenv("GARMIN_EMAIL"))
	password = os.Getenv("GARMIN_PASSWORD")
	if email == "" || password == "" {
		return "", "", errors.New("set GARMIN_EMAIL and GARMIN_PASSWORD in the environment (never paste them in chat)")
	}
	return email, password, nil
}

func runLogout(_ *cobra.Command, _ []string) error {
	garmin.ClearMFAPending(garmin.MFAPendingPath(sessionPath()))
	if err := removeSession(); err != nil {
		if os.IsNotExist(err) {
			fmt.Fprintln(os.Stderr, "Not logged in.")
			return nil
		}
		return err
	}
	fmt.Fprintln(os.Stderr, "Logged out.")
	return nil
}
