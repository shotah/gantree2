import type { Metadata } from "next";
import { FONT_BOOT, fontCss } from "@/app/lib/font";

// Manifest, apple-web-app, and the service worker are on the root layout.
export const metadata: Metadata = {
  title: "Chat — gantree",
  description: "Talk with an agent.",
};

export default function ChatLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: fontCss() }} />
      <script dangerouslySetInnerHTML={{ __html: FONT_BOOT }} />
      {children}
    </>
  );
}
