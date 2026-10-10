import { chipClass } from "@/app/components/shared/PageHeader";
import { ThemeSelect } from "@/app/components/shared/ThemeSelect";
import { TreeMark } from "@/app/components/shared/TreeMark";
import { loginError, loginHref } from "@/app/lib/login";
import { devDoorFor } from "./devDoor";

export const metadata = { title: "Log in — gantree" };

/** Never a static shell: the dev door depends on this request's host. */
export const dynamic = "force-dynamic";

const FEATURES = [
  { label: "Agents you run", dot: "bg-ok", tone: "border-ok/40 bg-ok/10" },
  { label: "Eleven tools", dot: "bg-info", tone: "border-info/40 bg-info/10" },
  { label: "On Cloudflare or at home", dot: "bg-accent", tone: "border-accent-line bg-accent-soft" },
] as const;

const googleButtonClass = "inline-flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 py-3 text-sm font-medium text-canvas shadow-md shadow-accent/30 hover:bg-accent-hover";

function GoogleGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" aria-hidden>
      <path
        fill="currentColor"
        d="M12.24 10.285V14.4h6.806c-.275 1.765-2.056 5.174-6.806 5.174-4.095 0-7.439-3.389-7.439-7.574S8.145 4.426 12.24 4.426c2.33 0 3.891.989 4.785 1.849l3.254-3.138C18.189 1.186 15.479 0 12.24 0c-6.635 0-12 5.365-12 12s5.365 12 12 12c6.926 0 11.52-4.869 11.52-11.726 0-.788-.085-1.39-.189-1.989H12.24z"
      />
    </svg>
  );
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const next = typeof params.next === "string" ? params.next : null;
  const error = typeof params.error === "string" ? params.error : null;
  const problem = loginError(error);
  const dev = await devDoorFor(next);

  return (
    <main className="relative mx-auto flex min-h-dvh w-full max-w-lg flex-col justify-center px-5 py-16">
      <div className="absolute right-4 top-4 z-20 w-40">
        <ThemeSelect align="end" />
      </div>
      <section className="relative overflow-hidden rounded-2xl border border-line bg-gradient-to-br from-accent-soft via-panel to-panel px-6 py-8 shadow-[0_1px_0_0_var(--line)_inset]">
        <span aria-hidden className="pointer-events-none absolute -right-10 -top-16 h-48 w-48 rounded-full bg-accent/20 blur-3xl" />
        <span aria-hidden className="pointer-events-none absolute -bottom-16 left-6 h-40 w-40 rounded-full bg-info/15 blur-3xl" />
        <div className="relative flex flex-col items-center gap-5 text-center">
          <span className="grid h-24 w-24 place-items-center rounded-2xl bg-canvas/80 text-fg ring-1 ring-accent-line shadow-[0_0_40px_-12px_var(--accent)]">
            <TreeMark className="h-20 w-20" title="gantree" />
          </span>
          <div className="space-y-1">
            <p className="text-sm font-semibold tracking-tight text-mark">gantree</p>
            <h1 className="text-balance text-2xl font-semibold tracking-tight text-fg sm:text-3xl">
              Your agents. Your tools. One door.
            </h1>
            <p className="text-sm text-muted">One door. Google account, then the list.</p>
          </div>
          <ul className="flex flex-wrap justify-center gap-2">
            {FEATURES.map((feature) => (
              <li key={feature.label} className={`${chipClass} ${feature.tone} text-body`}>
                <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${feature.dot}`} />
                {feature.label}
              </li>
            ))}
          </ul>
          <div className="flex w-full flex-col items-center gap-3">
            {problem
              ? (
                  <p role="alert" className="w-full rounded-xl border border-danger-line bg-danger-soft px-3 py-2 text-left text-sm text-danger">
                    {problem}
                  </p>
                )
              : null}
            <a href={loginHref(next)} className={googleButtonClass}>
              <GoogleGlyph />
              Continue with Google
            </a>
            {dev
              ? (
                  <a
                    href={dev.href}
                    data-dev-door
                    className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-ok/50 bg-ok/10 px-4 py-2.5 text-sm font-medium text-ok hover:bg-ok/20"
                  >
                    <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-ok" />
                    Continue as {dev.label} · loopback dev
                  </a>
                )
              : null}
            <p className="text-xs text-dim">
              Not on the list? Ask an admin to add your email under Users.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
