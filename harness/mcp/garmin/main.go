package main

import (
	"fmt"
	"os"

	"github.com/shotah/go-garmin/garmin"
)

func main() {
	if len(os.Args) > 1 && os.Args[1] == "host-manifest" {
		if err := garmin.WriteHostManifest(os.Stdout); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		return
	}
	fmt.Fprintln(os.Stderr, "usage: go run . host-manifest")
	fmt.Fprintln(os.Stderr, "CLI:   go run ./cmd/garmin …")
	os.Exit(2)
}
