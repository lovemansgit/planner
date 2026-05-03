// Day 10. Login page.
//
// Server component that renders the email/password form. Form action is
// the loginAction server action (./actions). On success the action emits
// `user.login_succeeded` and redirects to `?next=` or `/`. On failure the
// action emits `user.login_failed` with a structured `reason` enum and
// returns `{ error }` to be rendered by the client form.
//
// Brand language matches /admin/failed-pushes + /admin/webhook-config.

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
    <main className="min-h-screen bg-surface-primary text-navy font-sans">
      <div className="mx-auto max-w-md px-12 py-32">
        <header className="mb-16">
          <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--color-text-secondary)]">
            Subscription Planner
          </p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight">Sign in</h1>
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
