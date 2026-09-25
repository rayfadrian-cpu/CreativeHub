import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Creative Hub — Social content workspace",
  description: "Plan, review, and schedule social media content in one shared workspace.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased">{children}</body>
    </html>
  );
}
