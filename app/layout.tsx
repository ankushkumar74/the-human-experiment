import type { Metadata, Viewport } from "next";
import "@fontsource-variable/space-grotesk";
import "@fontsource-variable/inter";
import "./globals.css";
import { siteUrl } from "@/lib/env";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: {
    default: "The Human Experiment — Save the Plant",
    template: "%s · The Human Experiment",
  },
  description:
    "Millions of strangers. One tiny plant. Can we keep it alive? Water the shared plant once a day and help save it.",
  applicationName: "The Human Experiment",
  openGraph: {
    type: "website",
    siteName: "The Human Experiment",
    title: "The Human Experiment — Save the Plant",
    description:
      "One planet. Millions of strangers. One very thirsty plant. Join the experiment.",
  },
  twitter: {
    card: "summary_large_image",
    title: "The Human Experiment — Save the Plant",
    description:
      "One planet. Millions of strangers. One very thirsty plant. Join the experiment.",
  },
};

export const viewport: Viewport = {
  themeColor: "#fff8ec",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
