import type { HouseEnv } from "@/lib/agents/house";
import type { DirectoryKv } from "./directory";

/** Worker bindings the room reads. `AGENT` is one Durable Object per slug. */
export type ChatAuthEnv = {
  GOOGLE_CLIENT_ID?: string;
  SESSION_SECRET?: string;
  /** Optional static extra subs, `sub` or `sub:email`, comma or whitespace separated. */
  ALLOWED_SUBS?: string;
  /** `kit:token,ada:token` — env map of room bearers. The DO row wins when this slug is absent. */
  AGENT_BEARERS?: string;
  /** Loopback-only shared secret when Google is not configured. */
  CHAT_SECRET?: string;
  GANTREE_DEV_USER?: string;
  GANTREE_ADMINS?: string;
  GANTREE_ALLOW?: string;
};

export type AgentEnv = ChatAuthEnv & HouseEnv & {
  AGENT?: DurableObjectNamespace;
  SETTINGS?: DurableObjectNamespace;
  DIRECTORY?: DirectoryKv;
  LOCATION_HINT?: string;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
};
