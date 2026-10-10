export type ConfigGap = "session" | "agent" | "crane";

const AGENT = {
  heading: "No agent on this chat yet",
  detail: "Gantree Build → channel chat, then recreate. That pushes the bearer. Sign in with Google after it lands.",
};

const COPY: Record<ConfigGap, { heading: string; detail: string }> = {
  agent: AGENT,
  crane: AGENT,
  session: {
    heading: "Settings hasn't landed on the Worker",
    detail: "Gantree Settings → Chat: Save. That pushes Google and the session. Then build an agent.",
  },
};

export function ConfigGapNote({ gap }: { gap: ConfigGap }) {
  const copy = COPY[gap];
  return (
    <div className="flex max-w-sm flex-col items-center gap-3 text-center">
      <p className="text-sm text-body">{copy.heading}</p>
      <p className="text-sm text-muted">{copy.detail}</p>
    </div>
  );
}
