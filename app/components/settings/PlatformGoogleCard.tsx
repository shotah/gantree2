"use client";

import { useEffect, useState, type SubmitEvent } from "react";
import { chipClass } from "@/app/components/shared/PageHeader";
import { alertClass, dangerClass, inputClass, labelClass, primaryClass, quietClass } from "@/app/components/agents/Fold";
import type { ApiClient } from "./SettingsScreen";

/** Google OAuth web client ids look like `123-abc.apps.googleusercontent.com`. */
const GOOGLE_CLIENT_ID = /^\d+-[a-z0-9_-]+\.apps\.googleusercontent\.com$/i;

export type PlatformGooglePatch = { clientId?: string | null; clientSecret?: string | null };

/** Why a draft cannot be saved. `null` means it is safe to confirm. */
export function platformGoogleDraftError(patch: PlatformGooglePatch): string | null {
  if (typeof patch.clientId === "string" && patch.clientId !== "" && !GOOGLE_CLIENT_ID.test(patch.clientId)) {
    return "Google client id should look like 123-abc.apps.googleusercontent.com.";
  }
  if (typeof patch.clientSecret === "string") {
    if (patch.clientSecret.length < 8 || /\s/.test(patch.clientSecret)) {
      return "Google client secret should be the secret from that client, with no spaces.";
    }
  }
  return null;
}

type PlatformGoogleView = {
  clientId: string;
  secretSet: boolean;
  idFromDeploy: boolean;
  secretFromDeploy: boolean;
};

export function PlatformGoogleCard({ client }: { client: ApiClient }) {
  const [view, setView] = useState<PlatformGoogleView | null>(null);
  const [clientIdDraft, setClientIdDraft] = useState("");
  const [secretDraft, setSecretDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<PlatformGooglePatch | null>(null);

  useEffect(() => {
    let dead = false;
    void client("/api/platform/keys")
      .then(async (res) => {
        if (!res.ok) {
          throw new Error("request_failed");
        }
        return res.json<{ google: PlatformGoogleView }>();
      })
      .then((body) => {
        if (dead) {
          return;
        }
        setView(body.google);
        setClientIdDraft(body.google.clientId);
        setSecretDraft("");
        setError(null);
      })
      .catch(() => {
        if (!dead) {
          setError("Could not load platform Google settings.");
        }
      });
    return () => {
      dead = true;
    };
  }, [client]);

  function ask(body: PlatformGooglePatch) {
    const problem = platformGoogleDraftError(body);
    if (problem) {
      setError(problem);
      setPending(null);
      return;
    }
    setError(null);
    setPending(body);
  }

  async function patch(body: PlatformGooglePatch) {
    setPending(null);
    setBusy(true);
    setError(null);
    try {
      const res = await client("/api/platform/keys", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json: { google?: PlatformGoogleView; error?: string } = await res.json();
      if (!res.ok) {
        setError(json.error ?? "request_failed");
        return;
      }
      if (json.google) {
        setView(json.google);
        setClientIdDraft(json.google.clientId);
        setSecretDraft("");
      }
    } catch {
      setError("Could not save platform Google settings.");
    } finally {
      setBusy(false);
    }
  }

  function onSave(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!view) {
      return;
    }
    const patchBody: { clientId?: string | null; clientSecret?: string | null } = {};
    const idTrim = clientIdDraft.trim();
    if (idTrim !== view.clientId) {
      patchBody.clientId = idTrim;
    }
    const secretTrim = secretDraft.trim();
    if (secretTrim) {
      patchBody.clientSecret = secretTrim;
    }
    if (Object.keys(patchBody).length === 0) {
      return;
    }
    ask(patchBody);
  }

  if (!view) {
    return error ? <p role="alert" className={alertClass}>{error}</p> : <p className="text-sm text-dim">Loading platform Google settings.</p>;
  }

  const idPlaceholder = view.idFromDeploy && clientIdDraft === view.clientId ? "from deploy" : undefined;
  const secretPlaceholder = view.secretFromDeploy ? "from deploy" : "paste the secret";

  return (
    <form aria-label="Platform Google OAuth" className="flex flex-col gap-3" onSubmit={onSave}>
      {error ? <p role="alert" className={alertClass}>{error}</p> : null}
      <div className="flex flex-col gap-1">
        <label htmlFor="platform-google-client-id" className={labelClass}>Google client id</label>
        <input
          id="platform-google-client-id"
          type="text"
          autoComplete="off"
          spellCheck={false}
          disabled={busy}
          placeholder={idPlaceholder}
          value={clientIdDraft}
          onChange={(e) => setClientIdDraft(e.target.value)}
          className={inputClass}
        />
        <button type="button" disabled={busy} className={`${quietClass} self-start`} onClick={() => ask({ clientId: null })}>
          Clear stored client id
        </button>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="platform-google-client-secret" className={`${labelClass} flex items-center gap-2`}>
          Google client secret
          <span className={`${chipClass} ${view.secretSet ? "border-ok/40 bg-ok/10 text-ok" : "border-danger-line bg-danger-soft text-danger"}`}>
            {view.secretSet ? "set" : "missing"}
          </span>
        </label>
        <input
          id="platform-google-client-secret"
          type="password"
          autoComplete="new-password"
          spellCheck={false}
          disabled={busy}
          placeholder={secretPlaceholder}
          value={secretDraft}
          onChange={(e) => setSecretDraft(e.target.value)}
          className={inputClass}
        />
        <button type="button" disabled={busy} className={`${quietClass} self-start`} onClick={() => ask({ clientSecret: null })}>
          Clear stored client secret
        </button>
      </div>
      <button type="submit" disabled={busy} className={primaryClass}>Save</button>
      {pending
        ? (
            <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4">
              <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="platform-google-confirm-title"
                className="w-full max-w-md rounded-xl border border-danger-line bg-panel p-4 shadow-2xl"
              >
                <h2 id="platform-google-confirm-title" className="text-sm font-medium text-fg">Change Google sign-in?</h2>
                <p className="mt-2 text-sm text-body">
                  A wrong client locks everyone out, including you. Sign-in is this client, so you cannot open Settings to undo it.
                </p>
                <p className="mt-2 text-sm text-body">
                  A value saved here overrides the Worker until you clear it on this page.
                </p>
                <p className="mt-2 text-sm text-body">
                  The deploy client is in Cloudflare: Workers & Pages → gantree2 → Settings → Runtime variables and secrets.
                  GOOGLE_CLIENT_ID is a variable. GOOGLE_CLIENT_SECRET is a secret. Those apply again after the saved override is cleared.
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button type="button" className={quietClass} onClick={() => setPending(null)}>Cancel</button>
                  <button type="button" className={dangerClass} onClick={() => void patch(pending)}>
                    Confirm you want to make these changes
                  </button>
                </div>
              </div>
            </div>
          )
        : null}
    </form>
  );
}
