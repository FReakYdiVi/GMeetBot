import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Meet AI Scribe",
  description: "Caption-first MVP for a Google Meet summariser bot.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
