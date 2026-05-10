// Day 10. Login page.
//
// Server component that renders the email/password form. Form action is
// the loginAction server action (./actions). On success the action emits
// `user.login_succeeded` and redirects to `?next=` or `/`. On failure the
// action emits `user.login_failed` with a structured `reason` enum and
// returns `{ error }` to be rendered by the client form.
//
// Day-20 brand polish (FINDING-4): full-bleed split layout — left half
// hosts a vertically-centered form column with a substantial Transcorp
// logo lockup; right half is a co-equal cooler-bag photograph (desktop
// only). Per Love's Vercel walkthrough verdict: pivoted from the prior
// option (c) "small atmospheric accent" approach to a full split. The
// image is now a layout peer rather than a corner accent.
//
// Mobile (<768px) hides the right half entirely; the form column expands
// to full viewport width. Decorative semantics on the image are
// preserved (aria-hidden + alt="" + pointer-events-none).

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
    <main className="flex min-h-screen flex-col bg-surface-primary text-navy font-sans md:flex-row">
      {/* Left half — form column, vertically centered. Inner max-w-md
          constrains form width within the half; outer px-12 keeps
          breathing room from the half edges. */}
      <div className="flex w-full flex-col items-center justify-center px-12 py-16 md:w-1/2">
        <div className="w-full max-w-md">
          <Image
            src="/brand/transcorp-logo.svg"
            alt="Transcorp"
            width={186}
            height={64}
            priority
            unoptimized
            className="mb-16 h-20 w-auto"
          />
          <header className="mb-16">
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
