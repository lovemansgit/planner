// Day 10. Login page.
//
// Server component that renders the email/password form. Form action is
// the loginAction server action (./actions). On success the action emits
// `user.login_succeeded` and redirects to `?next=` or `/`. On failure the
// action emits `user.login_failed` with a structured `reason` enum and
// returns `{ error }` to be rendered by the client form.
//
// Day-20 brand polish (FINDING-4): Transcorp logo lockup at the top of
// the form column + atmospheric cooler-bag accent at the bottom-right
// (desktop only; hidden on mobile). Per reviewer Day-20 ruling option
// (c) — logo + single-column form + small atmospheric accent. The
// image carries no semantic meaning (alt="" + aria-hidden) and is
// pointer-events-none so it never intercepts form interactions.

import Image from "next/image";
import { redirect } from "next/navigation";

import { getServerSupabase } from "@/shared/request-context";

import { LoginForm } from "./form";

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface LoginPageProps {
  readonly searchParams: Promise<{ readonly next?: string }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  // If the visitor already has a session, send them on. Saves a click and
  // matches the "logged-in users skip login" expectation.
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const params = await searchParams;
  const next = sanitizeNext(params.next);

  if (user) {
    redirect(next);
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-surface-primary text-navy font-sans">
      {/* Atmospheric cooler-bag accent — desktop only. Soft mask fades
          the top + left edges so the photograph feels embedded in the
          page rather than pasted on. Decorative; aria-hidden + alt="". */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute bottom-[25%] right-10 hidden w-[25vw] max-w-[480px] md:block"
        style={{
          maskImage:
            "linear-gradient(to top left, black 25%, transparent 90%)",
          WebkitMaskImage:
            "linear-gradient(to top left, black 25%, transparent 90%)",
        }}
      >
        <Image
          src="/login-hero-cooler-bag.jpg"
          alt=""
          width={1600}
          height={904}
          priority
          className="block h-auto w-full"
        />
      </div>

      <div className="relative mx-auto max-w-md px-12 py-32">
        <header className="mb-16">
          <Image
            src="/brand/transcorp-logo.svg"
            alt="Transcorp"
            width={186}
            height={64}
            priority
            unoptimized
            className="mb-6 h-12 w-auto"
          />
          <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--color-text-secondary)]">
            Subscription Planner
          </p>
          <h1 className="mt-3 text-5xl font-bold tracking-tighter">Sign in</h1>
          <p className="mt-3 text-sm text-[color:var(--color-text-secondary)]">
            Enter your operator credentials to continue.
          </p>
        </header>
        <LoginForm next={next} />
      </div>
    </main>
  );
}

/**
 * Allow only relative paths starting with a single `/`. Blocks
 * protocol-relative (`//evil.com`) and absolute (`https://evil.com`)
 * redirect targets. Falls back to "/" for anything else.
 */
function sanitizeNext(next: string | undefined): string {
  if (!next) return "/";
  if (!next.startsWith("/")) return "/";
  if (next.startsWith("//")) return "/";
  return next;
}
