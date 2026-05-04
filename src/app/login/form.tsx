// Day 10. Client form for /login.
//
// Uses React 19's `useActionState` to render server-action error state
// inline. Server action throws NEXT_REDIRECT on success (handled by
// Next.js) and returns `{ error }` on failure (rendered below).

"use client";

import { useActionState } from "react";

import { loginAction, type LoginActionState } from "./actions";

const INITIAL: LoginActionState = {};

export function LoginForm({ next }: { readonly next: string }) {
  const [state, formAction, pending] = useActionState(loginAction, INITIAL);

  return (
    <form action={formAction} className="space-y-6">
      <input type="hidden" name="next" value={next} />

      <div>
        <label
          htmlFor="email"
          className="block text-xs uppercase tracking-[0.2em] text-[color:var(--color-text-secondary)]"
        >
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          className="mt-3 w-full border-0 border-b border-[color:var(--color-border-strong)] bg-transparent py-2 text-base text-navy placeholder:text-[color:var(--color-text-tertiary)] focus:border-navy focus:outline-none"
        />
      </div>

      <div>
        <label
          htmlFor="password"
          className="block text-xs uppercase tracking-[0.2em] text-[color:var(--color-text-secondary)]"
        >
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="mt-3 w-full border-0 border-b border-[color:var(--color-border-strong)] bg-transparent py-2 text-base text-navy focus:border-navy focus:outline-none"
        />
      </div>

      {state.error ? (
        <p
          role="alert"
          className="text-sm text-[color:var(--color-text-secondary)] border-t border-b border-[color:var(--color-border-strong)] py-3"
        >
          {state.error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="w-full border border-navy py-3 text-sm uppercase tracking-[0.2em] text-navy transition-opacity hover:opacity-80 disabled:opacity-50"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
