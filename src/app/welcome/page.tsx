// Day-58 Phase 9 — public marketing landing page (/welcome).
//
// NET-NEW public, unauthenticated surface authorized by
// PLANNER_PRODUCT_BRIEF.md §1/§2 + the v1.32 amendment (public landing scope +
// GCC market-count 3→6) + the v1.33 amendment (route resolved to /welcome; `/`
// stays the authenticated operator home, untouched). Built to the approved
// rev-2 Direction B+ mockup (memory/plans/day-58-landing-page, PR #583).
//
// SCAFFOLD STATUS — this page is deliberately:
//   · UNLINKED (no nav entry anywhere) and
//   · noindex (robots below) and
//   · NOT promoted,
// and it does NOT go to a live public route until Love approves the FINAL
// marketing copy. All prose here is PLACEHOLDER (brief-sourced framing, not
// final copy). The three proof facts — 50,000 packages/day · GCC cold-chain
// leader · 6 markets — are Love-confirmed (v1.32; "6 markets" is canonical,
// the other two are Love-gated marketing claims authorized to state). The
// merchant quote + partner logos remain placeholder slots until Love supplies
// real, approved ones.
//
// Public route: this lives at the top level (sibling of /login), OUTSIDE the
// (app)/(admin) auth route-groups, so it renders unauthenticated. No auth /
// middleware / schema / migration change. Static server component.

import Image from "next/image";

// Static server component → link CTAs use the shared B+ button classes
// (bButtonClass — the same recipe <Button> composes) on plain <a>. The
// <Button> component is client-interactive (it always wires an onClick on its
// <Link>), so it cannot be prerendered from a server component; bButtonClass
// gives byte-identical styling with no client boundary.
import { bButtonClass } from "@/components/button-recipe";

export const metadata = {
  title: "Transcorp Planner — one sale, months of deliveries",
  description:
    "Transcorp Planner holds the whole subscription and runs the deliveries — for meal-plan and subscription merchants.",
  // Unlinked + not for public go-live until Love clears final copy: keep it
  // out of search indexes even if the route is deployed.
  robots: { index: false, follow: false },
};

// The floating B+ surface + its navy structural spine (mirrors the shipped
// detail/table idiom, src/components/detail-view-recipe.ts). White-dominant per
// Love's standing preference: white card on white page, defined by shadow +
// spine, with a hairline frame.
const CARD =
  "relative overflow-hidden rounded-2xl bg-white shadow-b-card ring-1 ring-[color:var(--color-border-default)]";
const SPINE = "pointer-events-none absolute inset-y-0 left-0 z-[2] w-[3px] bg-navy";
const EYEBROW = "font-b-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-green";

// Hero "This week" rows — the window-track signature (faint 06:00–22:00
// baseline, green bar positioned to the window). Placeholder demo data.
const WEEK = [
  { day: "Mon", time: "16:00–18:00", left: "62.5%", width: "12.5%" },
  { day: "Tue", time: "16:00–18:00", left: "62.5%", width: "12.5%" },
  { day: "Wed", time: "16:00–18:00", left: "62.5%", width: "12.5%" },
  { day: "Thu", time: "16:00–18:00", left: "62.5%", width: "12.5%" },
  { day: "Fri", time: "16:00–18:00", left: "62.5%", width: "12.5%" },
];

const STEPS = [
  { n: "01", h: "Onboard the consignee", p: "Capture the customer, address and rules — once." },
  { n: "02", h: "The schedule generates", p: "Deliveries appear on a rolling horizon." },
  { n: "03", h: "Exceptions auto-handle", p: "Skip, pause, move, re-address — the tail fixes itself." },
  { n: "04", h: "It flows to Operations", p: "Every delivery lands on Transcorp's task list." },
];

function WindowTrack({ left, width, muted = false }: { left: string; width: string; muted?: boolean }) {
  return (
    <span className="relative block h-[7px] flex-1 rounded-full bg-[color:var(--color-b-track)]">
      <span
        className={`absolute inset-y-0 rounded-full ${muted ? "bg-[color:var(--color-led-ended)] opacity-40" : "bg-green opacity-90"}`}
        style={{ left, width }}
      />
    </span>
  );
}

export default function WelcomePage() {
  return (
    <main className="min-h-screen bg-white font-b-body text-[color:var(--color-ink)]">
      {/* NAV — white, thin hairline */}
      <header className="sticky top-0 z-20 border-b border-[color:var(--color-border-default)] bg-white/90 backdrop-blur">
        <nav className="mx-auto flex h-[70px] max-w-[1080px] items-center justify-between px-7">
          <Image
            src="/brand/transcorp-logo.svg"
            alt="Transcorp Planner"
            width={186}
            height={64}
            priority
            unoptimized
            className="h-[30px] w-auto"
          />
          <div className="flex items-center gap-2.5">
            <a href="/login" className={bButtonClass("secondary", "md")}>
              Log in to Transcorp Planner
            </a>
            {/* Request access = lead-capture / contact (NOT self-serve signup);
                destination TBD pending Love — placeholder anchor for now. */}
            <a href="#request-access" className={bButtonClass("primary", "md")}>
              Request access
            </a>
          </div>
        </nav>
      </header>

      {/* HERO */}
      <section className="mx-auto max-w-[1080px] px-7 pb-16 pt-[78px]">
        <div className="grid items-center gap-12 md:grid-cols-[1.04fr_0.96fr]">
          <div>
            <p className={EYEBROW}>Transcorp Planner · for meal-plan &amp; subscription merchants</p>
            <h1 className="mt-4 font-b-display text-[40px] font-bold leading-[1.04] tracking-[-0.03em] text-navy sm:text-[51px]">
              One sale.
              <br />
              Months of deliveries.
              <br />
              Zero manual rescheduling.
            </h1>
            <p className="mt-5 max-w-[31ch] text-lg leading-snug text-[color:var(--color-text-secondary)]">
              Your subscriptions don&apos;t fit in a spreadsheet. Put them somewhere that thinks in months, not days.
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <a href="#request-access" className={bButtonClass("primary", "lg")}>
                Request access
              </a>
              <a href="/login" className={bButtonClass("secondary", "lg")}>
                Log in to Transcorp Planner
              </a>
            </div>
            <p className="mt-4 flex items-center gap-2 text-[12.5px] text-[color:var(--color-text-tertiary)]">
              <span className="h-1.5 w-1.5 flex-none rounded-full bg-green" />
              Onboarded by Transcorp Merchant Success — nothing to wire up yourself.
            </p>
          </div>

          {/* hero product screen — the window-track signature */}
          <div className={CARD}>
            <span aria-hidden="true" className={SPINE} />
            <div className="flex items-baseline justify-between border-b border-[color:var(--color-border-strong)] px-5 pb-3 pt-4">
              <span className="font-b-display text-[15px] font-semibold text-navy">This week · Fatima Al Mansouri</span>
              <span className="font-b-mono text-[9.5px] text-[color:var(--color-text-tertiary)]">06:00–22:00</span>
            </div>
            {WEEK.map((r, i) => (
              <div
                key={r.day}
                className={`flex items-center px-5 py-[11px] ${i < WEEK.length - 1 ? "border-b border-[color:var(--color-border-default)]" : ""}`}
              >
                <span className="w-[42px] flex-none text-xs text-[color:var(--color-text-secondary)]">{r.day}</span>
                <span className="w-24 flex-none font-b-mono text-[11.5px] tabular-nums text-[color:var(--color-ink)]">
                  {r.time}
                </span>
                <WindowTrack left={r.left} width={r.width} />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* PROBLEM — one block, one visual */}
      <section className="border-t border-[color:var(--color-ivory)]">
        <div className="mx-auto grid max-w-[1080px] items-center gap-12 px-7 py-[62px] md:grid-cols-[1.1fr_0.9fr]">
          <div className="max-w-[62ch]">
            <p className={EYEBROW}>The problem</p>
            <h2 className="mt-3 font-b-display text-[32px] font-bold leading-tight tracking-[-0.02em] text-navy">
              One row. Months of work behind it.
            </h2>
            <p className="mt-3.5 max-w-[52ch] text-base text-[color:var(--color-text-secondary)]">
              You sold a three-month plan. Now it&apos;s a spreadsheet: sixty-odd deliveries to remember, a customer who
              wants Tuesdays skipped while they travel, a tail to re-add at the end, an address that changed last week.
              Miss one cell and someone&apos;s lunch doesn&apos;t arrive.
            </p>
          </div>
          <div className={`${CARD} p-5`}>
            <span aria-hidden="true" className={SPINE} />
            <p className="mb-3.5 font-b-mono text-[10px] uppercase tracking-[0.1em] text-[color:var(--color-text-tertiary)]">
              Subscriptions.xlsx
            </p>
            <div className="grid grid-cols-7 gap-1">
              {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
                <span key={i} className="py-0.5 text-center font-b-mono text-[9px] text-[color:var(--color-text-tertiary)]">
                  {d}
                </span>
              ))}
              {/* 4 weeks × 7 — a couple of flagged cells convey the pain */}
              {Array.from({ length: 28 }).map((_, i) => {
                const bad = i === 1 || i === 14;
                const warn = i === 5 || i === 9 || i === 24;
                const tone = bad
                  ? "bg-[color:var(--color-status-risk-bg)]"
                  : warn
                    ? "bg-[color:var(--color-status-paused-bg)]"
                    : "bg-[color:var(--color-border-default)]";
                return <span key={i} className={`block h-4 rounded-[3px] ${tone}`} />;
              })}
            </div>
            <p className="mt-3.5 text-xs font-semibold text-[color:var(--color-status-risk-ink)]">
              3 cells off. Someone&apos;s lunch is late.
            </p>
          </div>
        </div>
      </section>

      {/* PILLARS — 4 */}
      <section className="border-t border-[color:var(--color-ivory)]">
        <div className="mx-auto max-w-[1080px] px-7 py-[62px]">
          <div className="max-w-[62ch]">
            <p className={EYEBROW}>What Planner does</p>
            <h2 className="mt-3 font-b-display text-[32px] font-bold leading-tight tracking-[-0.02em] text-navy">
              Four things a spreadsheet never will.
            </h2>
          </div>

          {/* P1 */}
          <div className="grid items-center gap-12 border-t border-[color:var(--color-ivory)] pt-3.5 md:grid-cols-2 md:pt-12">
            <div>
              <span className="font-b-mono text-[13px] font-semibold text-green">01</span>
              <h3 className="mb-2.5 mt-2 font-b-display text-[25px] font-bold leading-[1.14] tracking-[-0.02em] text-navy">
                The subscription, not the task.
              </h3>
              <p className="max-w-[44ch] text-[15.5px] text-[color:var(--color-text-secondary)]">
                Most tools make you push one delivery at a time. Planner holds the whole subscription — the plan, the
                cadence, the rules — and generates the deliveries for you, on a rolling horizon. Set it up once; the days
                appear.
              </p>
            </div>
            <div className={`${CARD} p-4`}>
              <span aria-hidden="true" className={SPINE} />
              <div className="flex items-center gap-3.5">
                <div className="w-[140px] flex-none rounded-[10px] bg-[color:var(--color-surface-primary)] p-3">
                  <p className="font-b-mono text-[9px] uppercase tracking-[0.08em] text-[color:var(--color-text-tertiary)]">Rule</p>
                  <p className="mb-2 mt-0.5 text-[12.5px] font-semibold text-[color:var(--color-ink)]">Mon–Fri · 16:00–18:00</p>
                  <p className="font-b-mono text-[9px] uppercase tracking-[0.08em] text-[color:var(--color-text-tertiary)]">Length</p>
                  <p className="mt-0.5 text-[12.5px] font-semibold text-[color:var(--color-ink)]">12 weeks</p>
                </div>
                <span aria-hidden="true" className="flex-none text-xl text-[color:var(--color-text-tertiary)]">→</span>
                <div className="flex-1">
                  {["Mon 16 Jun", "Tue 17 Jun", "Wed 18 Jun", "Thu 19 Jun"].map((d, i, a) => (
                    <div
                      key={d}
                      className={`flex justify-between py-1.5 text-xs ${i < a.length - 1 ? "border-b border-[color:var(--color-border-default)]" : ""}`}
                    >
                      <span className="font-b-mono text-[color:var(--color-ink)]">{d}</span>
                      <span className="text-[11px] text-[color:var(--color-status-active-ink)]">Generated</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* P2 — skips that fix themselves (signature; static resolved state) */}
          <div className="grid items-center gap-12 border-t border-[color:var(--color-ivory)] py-12 md:grid-cols-2">
            <div>
              <span className="font-b-mono text-[13px] font-semibold text-green">02</span>
              <h3 className="mb-2.5 mt-2 font-b-display text-[25px] font-bold leading-[1.14] tracking-[-0.02em] text-navy">
                Skips that fix themselves.
              </h3>
              <p className="max-w-[44ch] text-[15.5px] text-[color:var(--color-text-secondary)]">
                A customer skips Tuesday. Planner cancels that delivery, re-adds it to the tail, and extends the end date —
                by your rules, the moment you tap skip. No deleting rows, no recounting, no forgetting the make-up day.
              </p>
            </div>
            <div className={`${CARD}`}>
              <span aria-hidden="true" className={SPINE} />
              <div className="flex items-center justify-between border-b border-[color:var(--color-border-strong)] px-4 py-3.5">
                <span className="font-b-mono text-[9.5px] uppercase tracking-[0.08em] text-[color:var(--color-text-tertiary)]">
                  Skip &amp; append
                </span>
                <span className="font-b-mono text-[11px] text-[color:var(--color-text-secondary)]">
                  Ends <span className="text-green">+1 day</span>
                </span>
              </div>
              {[
                { day: "Mon", tag: "Active", muted: false },
                { day: "Tue", tag: "Skipped", muted: true },
                { day: "Wed", tag: "Active", muted: false },
                { day: "…", tag: "Active", muted: false },
                { day: "+Sat", tag: "Re-added", muted: false, added: true },
              ].map((r, i, a) => (
                <div
                  key={i}
                  className={`flex items-center px-4 py-[9px] ${i < a.length - 1 ? "border-b border-[color:var(--color-border-default)]" : ""}`}
                >
                  <span className="w-[38px] flex-none text-[11.5px] text-[color:var(--color-text-secondary)]">{r.day}</span>
                  <WindowTrack left="30%" width="24%" muted={r.muted} />
                  <span
                    className={`w-[74px] flex-none text-right font-b-mono text-[9.5px] uppercase tracking-[0.04em] ${r.added ? "text-[color:var(--color-status-active-ink)]" : r.muted ? "text-[color:var(--color-status-paused-ink)]" : "text-[color:var(--color-text-tertiary)]"}`}
                  >
                    {r.tag}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* P3 — one list */}
          <div className="grid items-center gap-12 border-t border-[color:var(--color-ivory)] py-12 md:grid-cols-2">
            <div>
              <span className="font-b-mono text-[13px] font-semibold text-green">03</span>
              <h3 className="mb-2.5 mt-2 font-b-display text-[25px] font-bold leading-[1.14] tracking-[-0.02em] text-navy">
                One list, no reconciliation.
              </h3>
              <p className="max-w-[44ch] text-[15.5px] text-[color:var(--color-text-secondary)]">
                Every delivery Planner generates flows straight onto the same task list Transcorp Operations runs on. No
                parallel system to keep in sync, no end-of-day handover, no copy-paste between your sheet and the
                courier&apos;s.
              </p>
            </div>
            <div className={`${CARD} p-4`}>
              <span aria-hidden="true" className={SPINE} />
              <div className="flex items-center gap-3">
                <div className="flex flex-none flex-col gap-1.5">
                  {["Fatima · Mon", "Toufic · Mon", "Marwan · Mon"].map((m) => (
                    <span
                      key={m}
                      className="flex h-[18px] min-w-[78px] items-center rounded-[5px] bg-[color:var(--color-surface-primary)] px-2 font-b-mono text-[9.5px] text-[color:var(--color-text-tertiary)]"
                    >
                      {m}
                    </span>
                  ))}
                </div>
                <span aria-hidden="true" className="h-0.5 flex-1 bg-gradient-to-r from-[color:var(--color-border-strong)] to-green" />
                <div className="w-[186px] flex-none overflow-hidden rounded-[10px] ring-1 ring-[color:var(--color-border-default)]">
                  <p className="border-b border-[color:var(--color-border-strong)] px-3 py-2 font-b-mono text-[9px] uppercase tracking-[0.08em] text-[color:var(--color-text-tertiary)]">
                    Operations
                  </p>
                  {["16:00 · Jumeirah", "06:00 · Marina", "12:00 · Deira"].map((o, i, a) => (
                    <div
                      key={o}
                      className={`flex items-center gap-2 px-3 py-1.5 text-[11.5px] ${i < a.length - 1 ? "border-b border-[color:var(--color-border-default)]" : ""}`}
                    >
                      <span className="h-4 w-1 flex-none rounded-[2px] bg-[color:var(--color-led-active)]" />
                      {o}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* P4 — merchant control */}
          <div className="grid items-center gap-12 border-t border-[color:var(--color-ivory)] py-12 md:grid-cols-2">
            <div>
              <span className="font-b-mono text-[13px] font-semibold text-green">04</span>
              <h3 className="mb-2.5 mt-2 font-b-display text-[25px] font-bold leading-[1.14] tracking-[-0.02em] text-navy">
                Everything in one place.
              </h3>
              <p className="max-w-[44ch] text-[15.5px] text-[color:var(--color-text-secondary)]">
                It&apos;s not just automation you watch. Manage, track and tailor every subscription from one screen — skip
                or pause, move a delivery, change an address, read the calendar, and keep each consignee&apos;s CRM state
                current. You stay in control; Planner does the bookkeeping.
              </p>
            </div>
            <div className={`${CARD} p-4`}>
              <span aria-hidden="true" className={SPINE} />
              {[
                { nm: "Fatima Al Mansouri", tone: "active", label: "Active" },
                { nm: "Roudy Mhanna", tone: "paused", label: "Paused" },
              ].map((c, i, a) => (
                <div
                  key={c.nm}
                  className={`flex items-center justify-between py-2.5 ${i < a.length - 1 ? "border-b border-[color:var(--color-border-default)]" : ""}`}
                >
                  <span className="font-b-display text-sm font-semibold text-navy">{c.nm}</span>
                  <span
                    className="rounded-full px-2.5 py-0.5 text-[11px] font-semibold"
                    style={{
                      background: `var(--color-status-${c.tone}-bg)`,
                      color: `var(--color-status-${c.tone}-ink)`,
                    }}
                  >
                    {c.label}
                  </span>
                </div>
              ))}
              <div className="mt-3 flex flex-wrap gap-1.5">
                {["Skip", "Pause", "Move a delivery", "Change address"].map((chip) => (
                  <span
                    key={chip}
                    className="rounded-lg border border-[color:var(--color-border-strong)] px-2.5 py-1 text-[11.5px] text-[color:var(--color-text-secondary)]"
                  >
                    {chip}
                  </span>
                ))}
                <span className="rounded-lg border border-[color:rgb(var(--color-green-rgb)/0.34)] px-2.5 py-1 text-[11.5px] text-[color:var(--color-status-active-ink)]">
                  View calendar
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className="border-t border-[color:var(--color-ivory)]">
        <div className="mx-auto max-w-[1080px] px-7 py-[62px]">
          <div className="max-w-[62ch]">
            <p className={EYEBROW}>How it works</p>
            <h2 className="mt-3 font-b-display text-[32px] font-bold leading-tight tracking-[-0.02em] text-navy">
              Onboard once. The rest runs itself.
            </h2>
          </div>
          <div className="mt-9 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((s) => (
              <div key={s.n} className={`${CARD} p-5`}>
                <span aria-hidden="true" className={SPINE} />
                <p className="font-b-mono text-xs font-semibold text-green">{s.n}</p>
                <h4 className="mb-1.5 mt-2.5 font-b-display text-[15.5px] font-semibold leading-tight text-navy">{s.h}</h4>
                <p className="text-[13px] leading-snug text-[color:var(--color-text-secondary)]">{s.p}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* PROOF + CTA — the one cooler-bag proof moment */}
      <section id="request-access" className="border-t border-[color:var(--color-ivory)]">
        <div className="mx-auto max-w-[1080px] px-7 py-[62px]">
          <div className={`grid overflow-hidden md:grid-cols-[0.85fr_1.15fr] ${CARD}`}>
            <span aria-hidden="true" className={SPINE} />
            <div className="relative min-h-[300px] bg-[color:var(--color-ivory)]">
              <Image
                src="/login-hero-cooler-bag.jpg"
                alt=""
                aria-hidden="true"
                fill
                sizes="(max-width: 860px) 100vw, 40vw"
                className="object-cover object-center"
              />
            </div>
            <div className="p-9">
              <p className={EYEBROW}>Why Transcorp</p>
              <h2 className="mb-1 mt-2.5 font-b-display text-[27px] font-bold leading-tight tracking-[-0.02em] text-navy">
                The deliveries go to Transcorp.
              </h2>
              <p className="max-w-[42ch] text-[14.5px] text-[color:var(--color-text-secondary)]">
                Transcorp&apos;s logistics arm runs cold-chain delivery for meal-plan merchants. Planner sits on top of the
                operation you already trust.
              </p>
              {/* Love-confirmed facts (v1.32): "6 markets" is canonical; "50,000/day"
                  and "GCC cold-chain leader" are Love-gated marketing claims authorized
                  to state, finalized before public go-live. */}
              <div className="my-6 flex flex-wrap gap-7">
                {[
                  { v: "50,000", unit: "/day", k: "packages delivered" },
                  { v: "GCC", unit: "", k: "cold-chain delivery leader" },
                  { v: "6", unit: "", k: "markets" },
                ].map((s) => (
                  <div key={s.k}>
                    <p className="font-b-mono text-[27px] font-medium leading-none tabular-nums text-navy">
                      {s.v}
                      {s.unit ? <span className="text-sm">{s.unit}</span> : null}
                    </p>
                    <p className="mt-1.5 max-w-[15ch] text-[12.5px] text-[color:var(--color-text-secondary)]">{s.k}</p>
                  </div>
                ))}
              </div>
              {/* Merchant quote + logos stay placeholder until Love supplies real, approved ones. */}
              <div className="flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-[color:var(--color-border-strong)] px-4 py-3.5 text-[13.5px] text-[color:var(--color-text-tertiary)]">
                <span className="rounded-full bg-[color:var(--color-status-paused-bg)] px-2.5 py-0.5 font-b-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--color-status-paused-ink)]">
                  Placeholder
                </span>
                <span>Merchant quote &amp; logos — pending real, approved ones from Love.</span>
              </div>
              <div className="mt-7 flex flex-wrap items-center justify-between gap-4">
                <span className="font-b-display text-[22px] font-bold tracking-[-0.01em] text-navy">Sell the plan. Let it run.</span>
                <div className="flex flex-wrap gap-3">
                  <a href="#request-access" className={bButtonClass("primary", "lg")}>
                    Request access
                  </a>
                  <a href="/login" className={bButtonClass("secondary", "lg")}>
                    Log in
                  </a>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="border-t border-[color:var(--color-ivory)]">
        <div className="mx-auto max-w-[1080px] px-7 pb-12 pt-8">
          <div className="flex flex-wrap items-center justify-between gap-5">
            <Image
              src="/brand/transcorp-logo.svg"
              alt="Transcorp Planner"
              width={186}
              height={64}
              unoptimized
              className="h-[26px] w-auto opacity-90"
            />
            <div className="flex gap-5 text-[13px]">
              <a href="#request-access" className="text-[color:var(--color-text-secondary)] hover:text-navy">
                Request access
              </a>
              <a href="/login" className="text-[color:var(--color-text-secondary)] hover:text-navy">
                Log in
              </a>
            </div>
          </div>
          <p className="mt-3.5 text-xs text-[color:var(--color-text-tertiary)]">
            Planner is a Transcorp product — subscription management for meal-plan &amp; subscription merchants.
            Placeholder copy; not for publication until final copy is approved.
          </p>
        </div>
      </footer>
    </main>
  );
}
