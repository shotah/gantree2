import { type PluginKeyMeta } from "@/lib/agents/keys";

/** Optional. Image generation uses `LLM_API_KEY` when this is unset. */
export const keys: readonly PluginKeyMeta[] = [
  {
    name: "IMAGE_API_KEY",
    label: "Image API key",
    help: "Optional. Leave it unset and pictures use the model key (LLM_API_KEY). Or create a separate key at https://aistudio.google.com/apikey.",
    example: "AIza...",
    where: "https://aistudio.google.com/apikey",
    optional: true,
    kind: "secret",
  },
];
