import type { Metadata } from "next";
import { headers } from "next/headers";
import { FONT_BOOT, fontCss } from "@/app/lib/font";
import { scriptNonce } from "@/lib/door/headers";

// Manifest, apple-web-app, and the service worker are on the root layout.
export const metadata: Metadata = {
  title: "Chat — gantree",
  description: "Talk with an agent.",
};

export default async function ChatLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const nonce = scriptNonce(await headers());
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: fontCss() }} />
      <script nonce={nonce} dangerouslySetInnerHTML={{ __html: FONT_BOOT }} />
      {children}
    </>
  );
}
