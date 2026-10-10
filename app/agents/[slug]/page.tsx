import { AgentDashboard } from "@/app/components/agents/AgentDashboard";

export const metadata = { title: "Agent — gantree" };

export default async function AgentPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <AgentDashboard slug={slug} />;
}
