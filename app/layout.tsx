import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "OpsAtlas — Operations Command Console",
  description: "A privacy-first fleet health and incident command console.",
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
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
