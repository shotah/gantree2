import type { Metadata, Viewport } from "next";
import { DEFAULT_THEME, THEME_BOOT, themeCss, themeOf } from "./lib/theme";
import "./globals.css";

export const metadata: Metadata = {
  title: "gantree",
  description: "Settings, chat, and the harness. One door.",
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: themeOf(DEFAULT_THEME).tokens.canvas,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-theme={DEFAULT_THEME} suppressHydrationWarning>
      <head>
        <style dangerouslySetInnerHTML={{ __html: themeCss() }} />
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      <body className="min-h-screen min-w-0 overflow-x-clip bg-canvas text-body antialiased">
        {children}
      </body>
    </html>
  );
}
