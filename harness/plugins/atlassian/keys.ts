import { type PluginKeyMeta } from "@/lib/agents/keys";

const where = "https://id.atlassian.com/manage-profile/security/api-tokens";

export const keys: readonly PluginKeyMeta[] = [
  {
    name: "ATLASSIAN_SITE",
    label: "Atlassian site",
    help: "Your Atlassian Cloud site hostname or URL for Jira and Confluence, such as https://your-site.atlassian.net.",
    example: "https://your-site.atlassian.net",
    where,
    kind: "text",
  },
  {
    name: "ATLASSIAN_EMAIL",
    label: "Atlassian email",
    help: "The Atlassian account email you use with Jira and Confluence Cloud.",
    example: "you@example.com",
    where,
    kind: "text",
  },
  {
    name: "ATLASSIAN_API_TOKEN",
    label: "Atlassian API token",
    help: "Create an API token on that page and paste it here; the same email and token read Jira and Confluence.",
    example: "ATATT...",
    where,
    kind: "secret",
  },
];
