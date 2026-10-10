//go:build ignore

// check-coverage fails if go cover total is below the given minimum.
// Usage: go run scripts/check-coverage.go coverage.out 70
package main

import (
	"fmt"
	"os"
	"os/exec"
	"strconv"
	"strings"
)

func main() {
	profile := "coverage.out"
	min := 70.0
	if len(os.Args) > 1 {
		profile = os.Args[1]
	}
	if len(os.Args) > 2 {
		v, err := strconv.ParseFloat(os.Args[2], 64)
		if err != nil {
			fmt.Fprintf(os.Stderr, "invalid min coverage %q: %v\n", os.Args[2], err)
			os.Exit(2)
		}
		min = v
	}

	out, err := exec.Command("go", "tool", "cover", "-func="+profile).Output()
	if err != nil {
		fmt.Fprintf(os.Stderr, "go tool cover: %v\n", err)
		os.Exit(1)
	}

	total := -1.0
	for _, line := range strings.Split(string(out), "\n") {
		if !strings.HasPrefix(line, "total:") {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 3 {
			continue
		}
		pct := strings.TrimSuffix(fields[len(fields)-1], "%")
		total, err = strconv.ParseFloat(pct, 64)
		if err != nil {
			fmt.Fprintf(os.Stderr, "parse total %q: %v\n", pct, err)
			os.Exit(1)
		}
		break
	}
	if total < 0 {
		fmt.Fprintln(os.Stderr, "could not parse total coverage")
		os.Exit(1)
	}

	if total < min {
		fmt.Printf("Coverage %.1f%% is below the %.0f%% minimum\n", total, min)
		os.Exit(1)
	}
	fmt.Printf("Coverage %.1f%% meets the %.0f%% minimum\n", total, min)
}
