import type { Metadata } from "next";
import { Bricolage_Grotesque, Hanken_Grotesk, IBM_Plex_Mono, Manrope, Mulish, Sanchez } from "next/font/google";

import { registerAuditObserver } from "../modules/audit";

import "./globals.css";
import "../styles/brand-tokens.css";

// Register the audit module's serviceRoleObserver once per server
// process. Module loads are cached in Next.js, so re-renders of this
// component do not re-register; the registration happens on first
// import. Per the R-3 + R-4 contract, this wires `db.service_role.use`
// audit events to fire on every withServiceRole call (with the
// recursion-skip handled inside serviceRoleAuditObserver).
registerAuditObserver();

const mulish = Mulish({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800"],
  variable: "--font-mulish",
  display: "swap",
});

const sanchez = Sanchez({
  subsets: ["latin"],
  weight: ["400"],
  style: ["normal", "italic"],
  variable: "--font-sanchez",
  display: "swap",
});

const manrope = Manrope({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-manrope",
  display: "swap",
});

// Phase 9 — Direction B ("Dispatch") skin faces (visual-directions pick, PR #568).
// Wired here as the foundation for the Phase 9 rebuild: Hanken Grotesk (body),
// Bricolage Grotesque (display), IBM Plex Mono (figures/IDs). In THIS bundle only
// the shared <Button> consumes --font-hanken; the app's global display/body faces
// stay Manrope/Mulish until the typography rebuild bundle re-skins them app-wide,
// so no screen changes here. Bricolage + Plex Mono are loaded ready for the
// imminent table/detail bundles.
const hankenGrotesk = Hanken_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-hanken",
  display: "swap",
});

const bricolageGrotesque = Bricolage_Grotesque({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-bricolage",
  display: "swap",
});

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-plex-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Subscription Planner",
  description: "Transcorp Subscription Planner — meal plan subscription management on SuiteFleet",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${manrope.variable} ${mulish.variable} ${sanchez.variable} ${hankenGrotesk.variable} ${bricolageGrotesque.variable} ${ibmPlexMono.variable}`}
    >
      <body className="antialiased font-sans">{children}</body>
    </html>
  );
}
