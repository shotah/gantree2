import { type PluginKeyMeta } from "@/lib/agents/keys";

export const keys: readonly PluginKeyMeta[] = [
  {
    name: "GARMIN_EMAIL",
    label: "Garmin email",
    help: "Garmin Connect sign-in email for the account at https://connect.garmin.com/.",
    example: "you@example.com",
    where: "https://connect.garmin.com/",
    kind: "text",
  },
  {
    name: "GARMIN_PASSWORD",
    label: "Garmin password",
    help: "Garmin Connect password for that email; sign in at https://connect.garmin.com/.",
    example: "••••••••",
    where: "https://connect.garmin.com/",
    kind: "secret",
  },
  {
    name: "GARMIN_TOOL_TIER",
    label: "Garmin tool tier",
    help: "Optional Garmin catalog size, one of core, extended, or complete; leave it unset for core.",
    example: "extended",
    where: "https://github.com/shotah/gantree2/blob/main/docs/mcp.md#keys",
    optional: true,
    kind: "text",
  },
];
