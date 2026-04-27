import type { Metadata } from "next";

import { registerAuditObserver } from "../modules/audit";

import "./globals.css";

// Register the audit module's serviceRoleObserver once per server
// process. Module loads are cached in Next.js, so re-renders of this
// component do not re-register; the registration happens on first
// import. Per the R-3 + R-4 contract, this wires `db.service_role.use`
// audit events to fire on every withServiceRole call (with the
// recursion-skip handled inside serviceRoleAuditObserver).
registerAuditObserver();

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
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
