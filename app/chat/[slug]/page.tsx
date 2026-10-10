import { PhoneShell } from "@/app/components/chat/PhoneShell";

export default async function ChatPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <PhoneShell slug={slug} />;
}
