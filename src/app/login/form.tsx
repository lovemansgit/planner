// Day 10. Client form for /login.
//
// Uses React 19's `useActionState` to render server-action error state
// inline. Server action throws NEXT_REDIRECT on success (handled by
// Next.js) and returns `{ error }` on failure (rendered below).
//
// Day-58 Phase 9 — Direction B+ reskin (visual only). The control wiring
// (useActionState + loginAction + the hidden `next` field + the rendered
// `state.error`) is unchanged; only the chrome moved to B+: <Field> labels
// (sentence-case, D2), inputs on the warm-white control surface with the
// green focus ring (mirroring the shared <Select> chrome), the form-level
// error as a soft risk-tone alert, and the unified green primary <Button>.

"use client";

import { useActionState } from "react";

import { Button } from "@/components/Button";
import { Field } from "@/components/Field";

import { loginAction, type LoginActionState } from "./actions";

const INITIAL: LoginActionState = {};

// B+ text-input chrome. Mirrors the shared <Select> control surface
// (src/components/form-field-recipe.ts SELECT_BASE) — same height, radius,
// warm-white fill, strong border, and green focus ring — so the login inputs
// match the app's form controls. A shared <TextInput> is the documented form-kit
// follow-up (form-field-recipe.ts scope note); until it lands these two inputs
// reuse the Select's token classes rather than reinventing the chrome.
const INPUT =
  "h-11 w-full rounded-[10px] border border-[color:var(--color-border-strong)] bg-[color:var(--color-b-card)] px-3.5 text-sm text-[color:var(--color-ink)] transition-colors placeholder:text-[color:var(--color-text-tertiary)] focus:outline-none focus-visible:border-navy focus-visible:ring-2 focus-visible:ring-[color:var(--color-b-focus-ring)]";

export function LoginForm({ next }: { readonly next: string }) {
  const [state, formAction, pending] = useActionState(loginAction, INITIAL);

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <input type="hidden" name="next" value={next} />

      <Field label="Email" htmlFor="email">
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          placeholder="you@yourkitchen.ae"
          className={INPUT}
        />
      </Field>

      <Field label="Password" htmlFor="password">
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className={INPUT}
        />
      </Field>

      {state.error ? (
        <p
          role="alert"
          className="rounded-[10px] bg-[color:var(--color-status-risk-bg)] px-3.5 py-2.5 text-[13px] text-[color:var(--color-status-risk-ink)]"
        >
          {state.error}
        </p>
      ) : null}

      <Button variant="primary" size="lg" type="submit" loading={pending} className="mt-1 w-full">
        {pending ? "Signing in…" : "Log in to Transcorp Planner"}
      </Button>
    </form>
  );
}
