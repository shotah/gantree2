import { ThemeSelect } from "@/app/components/shared/ThemeSelect";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-10">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold text-fg">gantree</h1>
        <div className="w-40">
          <ThemeSelect />
        </div>
      </header>
      <p className="text-sm text-muted">
        You are through the door. Agents, Users, and Settings land here next.
      </p>
      <form action="/api/auth/logout" method="post">
        <button type="submit" className="rounded border border-line px-3 py-1.5 text-sm text-body hover:bg-track">
          Log out
        </button>
      </form>
    </main>
  );
}
