// Day 10. Login page.
//
// Server component that renders the email/password form. Form action is
// the loginAction server action (./actions). On success the action emits
// `user.login_succeeded` and redirects to `?next=` or `/`. On failure the
// action emits `user.login_failed` with a structured `reason` enum and
// returns `{ error }` to be rendered by the client form.
//
// Day-58 Phase 9 — Direction B+ reskin (visual only). The Day-20 full-bleed
// split is KEPT (form left, real cooler-bag photo right) and reskinned to
// B+: a clean white form panel (white-dominant per Love's standing
// preference), a Bricolage display heading, a mono eyebrow, sentence-case
// labels, the unified green primary <Button>, and a single 3px navy
// structural spine at the page edge. This is a brand-pass — the auth flow
// below (session check, sanitizeNext, redirect) and the form's behaviour
// (./form, ./actions) are unchanged.

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
    <main className="relative flex min-h-screen flex-col bg-white font-b-body text-navy md:flex-row">
      {/* The one B+ structural accent — a 3px navy spine at the page edge.
          Mirrors the shipped detail/table surfaces (detail-view-recipe.ts). */}
      <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-0 z-10 w-[3px] bg-navy" />

      {/* Left half — white form panel, vertically centred. */}
      <div className="flex w-full flex-col items-center justify-center px-8 py-16 md:w-1/2 md:px-12">
        <div className="w-full max-w-sm">
          <Image
            src="/brand/transcorp-logo.svg"
            alt="Transcorp"
            width={186}
            height={64}
            priority
            unoptimized
            className="mb-10 h-11 w-auto"
          />
          <p className="font-b-mono text-[11px] uppercase tracking-[0.16em] text-[color:var(--color-text-tertiary)]">
            Subscription Planner
          </p>
          <h1 className="mt-2 font-b-display text-[33px] font-bold leading-[1.05] tracking-[-0.02em] text-navy">
            Log in
          </h1>
          <p className="mt-2 text-sm text-[color:var(--color-text-secondary)]">
            Enter your operator credentials to continue.
          </p>
          <div className="mt-8">
            <LoginForm next={next} />
          </div>
          <p className="mt-6 text-xs text-[color:var(--color-text-tertiary)]">
            Operator access is provisioned by Transcorp.
          </p>
        </div>
      </div>

      {/* Right half — cooler-bag photograph, full-bleed, desktop only.
          Decorative; aria-hidden + alt="" + pointer-events-none. */}
      <div
        aria-hidden="true"
        className="pointer-events-none relative hidden md:block md:h-screen md:w-1/2"
      >
        <Image
          src="/login-hero-cooler-bag.jpg"
          alt=""
          fill
          priority
          sizes="50vw"
          className="object-cover object-center"
        />
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
