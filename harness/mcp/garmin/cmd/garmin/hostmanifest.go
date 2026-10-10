package main

import (
	"os"

	"github.com/shotah/go-garmin/garmin"
	"github.com/spf13/cobra"
)

var hostManifestCmd = &cobra.Command{
	Use:   "host-manifest",
	Short: "Print host grant shape as JSON",
	Long:  "Machine-readable env keys and auth hop for gantree / ai-gantry. No login required.",
	Args:  cobra.NoArgs,
	RunE: func(_ *cobra.Command, _ []string) error {
		return garmin.WriteHostManifest(os.Stdout)
	},
}

func init() {
	rootCmd.AddCommand(hostManifestCmd)
}
