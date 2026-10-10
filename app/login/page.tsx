import { loginError, loginHref } from "@/app/lib/login";

export const metadata = { title: "Log in — gantree" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const next = typeof params.next === "string" ? params.next : null;
  const error = typeof params.error === "string" ? params.error : null;
  const problem = loginError(error);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-6 px-6 py-10">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold text-fg">gantree</h1>
        <p className="text-sm text-muted">One door. Google account, then the list.</p>
      </header>

      {problem
        ? (
            <p role="alert" className="rounded border border-danger-line bg-danger-soft px-3 py-2 text-sm text-danger">
              {problem}
            </p>
          )
        : null}

      <a
        href={loginHref(next)}
        className="inline-flex items-center justify-center rounded bg-accent px-4 py-2.5 text-sm font-medium text-canvas hover:bg-accent-hover"
      >
        Continue with Google
      </a>

      <p className="text-xs text-dim">
        Not on the list? Ask an admin to add your email under Users.
      </p>
    </main>
  );
}
