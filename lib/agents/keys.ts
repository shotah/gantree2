/**
 * Every key the Keys fold knows how to explain. Plugin rows come from each
 * plugin's `keys` export. House rows are the Worker env the harness already
 * reads. `needs` on the tools grid is the required slice of this list.
 */
import { keys as feedsKeys } from "@/harness/plugins/feeds/keys";
import { keys as flightsKeys } from "@/harness/plugins/flights/keys";
import { keys as garminKeys } from "@/harness/plugins/garmin/keys";
import { keys as googleKeys } from "@/harness/plugins/google/keys";
import { keys as imageKeys } from "@/harness/plugins/image/keys";
import { keys as googleHealthKeys } from "@/harness/plugins/google-health/keys";
import { keys as mapsKeys } from "@/harness/plugins/maps/keys";
import { keys as websearchKeys } from "@/harness/plugins/websearch/keys";
import { keys as rentalsKeys } from "@/harness/plugins/rentals/keys";
import { keys as stravaKeys } from "@/harness/plugins/strava/keys";
import { keys as twitterKeys } from "@/harness/plugins/twitter/keys";

export type KeyKind = "secret" | "text";

/** What a plugin exports. The catalog adds `plugin`. */
export type PluginKeyMeta = {
  name: string;
  label: string;
  /** One sentence: what it is, and the console to get it from. */
  help: string;
  /** Redacted shape, such as `sk-...`. */
  example?: string;
  where: string;
  /** Unset is fine. `ready()` does not treat it as `no_key`. */
  optional?: boolean;
  kind: KeyKind;
};

export type KnownKey = PluginKeyMeta & {
  /** `house` or a plugin name. */
  plugin: string;
};

const houseMeta: readonly PluginKeyMeta[] = [
  {
    name: "LLM_BASE_URL",
    label: "Model endpoint",
    help: "OpenAI-compatible chat endpoint for the model, such as the Gemini one documented at https://ai.google.dev/gemini-api/docs/openai.",
    example: "https://generativelanguage.googleapis.com/v1beta/openai",
    where: "https://ai.google.dev/gemini-api/docs/openai",
    kind: "text",
  },
  {
    name: "LLM_API_KEY",
    label: "Model API key",
    help: "Secret for that endpoint, from the provider console such as https://aistudio.google.com/apikey.",
    example: "sk-...",
    where: "https://aistudio.google.com/apikey",
    kind: "secret",
  },
  {
    name: "LLM_MODEL",
    label: "Model id",
    help: "Model id the endpoint serves, from the provider's model list at https://ai.google.dev/gemini-api/docs/models.",
    example: "gemini-3.8-flash",
    where: "https://ai.google.dev/gemini-api/docs/models",
    kind: "text",
  },
];

function tagged(plugin: string, list: readonly PluginKeyMeta[]): KnownKey[] {
  return list.map((key) => ({ ...key, plugin }));
}

/** House first, then plugins in `allPlugins` order. */
export const KNOWN_KEYS: readonly KnownKey[] = [
  ...tagged("house", houseMeta),
  ...tagged("feeds", feedsKeys),
  ...tagged("websearch", websearchKeys),
  ...tagged("twitter", twitterKeys),
  ...tagged("image", imageKeys),
  ...tagged("strava", stravaKeys),
  ...tagged("maps", mapsKeys),
  ...tagged("flights", flightsKeys),
  ...tagged("rentals", rentalsKeys),
  ...tagged("google-health", googleHealthKeys),
  ...tagged("google", googleKeys),
  ...tagged("garmin", garminKeys),
];

const byName = new Map(KNOWN_KEYS.map((key) => [key.name, key]));

export function knownKey(name: string): KnownKey | undefined {
  return byName.get(name);
}

/** Help plus the redacted example, one line for a title or a hint. */
export function keyHint(key: KnownKey): string {
  return key.example ? `${key.help} Example: ${key.example}` : key.help;
}

/** Required keys for one plugin, in catalog order. Optional keys are left out. */
export function needsOf(plugin: string): string[] {
  return KNOWN_KEYS.filter((key) => key.plugin === plugin && key.optional !== true).map((key) => key.name);
}

/** Optional keys for one plugin, in catalog order. */
export function optionalOf(plugin: string): string[] {
  return KNOWN_KEYS.filter((key) => key.plugin === plugin && key.optional === true).map((key) => key.name);
}

/**
 * Known keys still worth offering. A name the agent already set, or one the
 * house already supplies, is not in the list. House stays first.
 */
export function pickerKeys(envKeys: readonly string[], house: readonly string[]): KnownKey[] {
  const skip = new Set<string>([...envKeys, ...house]);
  return KNOWN_KEYS.filter((key) => !skip.has(key.name));
}

export type KeyGroup = { plugin: string; keys: KnownKey[] };

/** Groups a picker list. Input order is kept, so house stays first. */
export function groupKeys(keys: readonly KnownKey[]): KeyGroup[] {
  const groups: KeyGroup[] = [];
  for (const key of keys) {
    const last = groups[groups.length - 1];
    if (last && last.plugin === key.plugin) {
      last.keys.push(key);
    } else {
      groups.push({ plugin: key.plugin, keys: [key] });
    }
  }
  return groups;
}
