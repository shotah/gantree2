import { NewAgent } from "@/app/components/agents/NewAgent";

export const metadata = { title: "New agent — gantree" };

export default async function NewAgentPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const home = params.home === "1";
  return <NewAgent home={home} />;
}
