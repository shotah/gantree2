import type { Message } from "@/harness/core/provider";

/** How system blocks reach the OpenAI-compat body. Empty or unknown is `auto`. */
export function wireMessages(model: string, messages: Message[]): Message[] {
  return wireMessagesMode("auto", model, messages);
}

/**
 * Gemini's compatibility layer keeps one system instruction: extra system
 * turns (especially after a user) overwrite the persona or vanish. Fold those
 * into one leading system message. OpenAI and Ollama keep the agent's layout.
 */
export function wireMessagesMode(mode: string, model: string, messages: Message[]): Message[] {
  if (!foldToOne(mode, model)) {
    return messages;
  }
  return foldSystemMessages(messages);
}

function foldToOne(mode: string, model: string): boolean {
  switch (mode.trim().toLowerCase()) {
    case "one":
      return true;
    case "many":
      return false;
    default:
      return model.toLowerCase().includes("gemini");
  }
}

function foldSystemMessages(messages: Message[]): Message[] {
  let lastUser = -1;
  for (let i = 0; i < messages.length; i++) {
    if (messages[i]?.role === "user") {
      lastUser = i;
    }
  }
  const turn: string[] = [];
  const standing: string[] = [];
  const rest: Message[] = [];
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    if (!message) {
      continue;
    }
    if (message.role !== "system") {
      rest.push(message);
      continue;
    }
    const content = message.content.trim();
    if (content === "") {
      continue;
    }
    if (lastUser >= 0 && i > lastUser) {
      turn.push(content);
    } else {
      standing.push(content);
    }
  }
  if (turn.length === 0 && standing.length === 0) {
    return rest;
  }
  // Standing blocks (persona, summary, hydration) lead so identity is first
  // and the byte-stable prefix stays cacheable. This-turn clock/GPS closes
  // the one system blob for recency.
  const blocks = [...standing, ...turn];
  return [{ role: "system", content: blocks.join("\n\n") }, ...rest];
}
