import type { Metadata } from "next";
import { Geist, Geist_Mono, Cinzel_Decorative, Uncial_Antiqua } from "next/font/google";
import "./globals.css";
import { ClickSound } from "@/components/ClickSound";
import { SteamUsernameGate } from "@/components/SteamUsernameGate";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Decorative serif for the Founder name color (migration 082).
const cinzelDecorative = Cinzel_Decorative({
  variable: "--font-cinzel",
  weight: ["700", "900"],
  subsets: ["latin"],
});

// Uncial blackletter for the season-pass "First Souls" name color (migration 083).
const uncialAntiqua = Uncial_Antiqua({
  variable: "--font-uncial",
  weight: ["400"],
  subsets: ["latin"],
});

// Site-wide metadata. The icon / apple-icon / opengraph-image /
// twitter-image PNGs co-located in this directory are auto-wired by
// Next.js into the appropriate <head> tags — we only need to set the
// text fields here.
const title = "Vice and Virtue";
const description =
  "A hidden-role social deduction party game for 6–20 players. Deceive, persuade, survive.";

export const metadata: Metadata = {
  // Canonical site origin — OG/Twitter image URLs and other relative
  // metadata resolve against this. Set to the owned custom domain.
  metadataBase: new URL("https://viceandvirtue.io"),
  title,
  description,
  openGraph: {
    title,
    description,
    type: "website",
    siteName: title,
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${cinzelDecorative.variable} ${uncialAntiqua.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <ClickSound />
        {/* Steam build only: the one-time "choose your username" step. Renders
            nothing on the website and nothing once the name is set. */}
        <SteamUsernameGate />
        {children}
      </body>
    </html>
  );
}
