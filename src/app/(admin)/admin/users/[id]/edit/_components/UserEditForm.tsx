// Item 2 — UserEditForm. Client component: edits a user's full name and
// role. Role options are fixed at load (they derive from the user's
// tenant, which is NOT editable here). Tenant + email render read-only
// for context. useActionState wires submit → the bound server action;
// on success the action redirects to the detail view.
//
// Brand-canon form styling matches /admin/users/new (hairline stone-200
// fields, navy focus, 120ms ease-out, sentence-case labels).

"use client";

import Link from "next/link";
import { useActionState } from "react";

import {
  updateUserAction,
  type UpdateUserActionResult,
} from "../_actions";
import type { RoleOption } from "../_helpers";

export interface UserEditFormProps {
  readonly userId: string;
  readonly email: string;
  readonly tenantName: string;
  readonly tenantSlug: string;
  readonly initialDisplayName: string | null;
  readonly initialRoleSlug: string;
  readonly roleOptions: readonly RoleOption[];
}

export function UserEditForm({
  userId,
  email,
  tenantName,
  tenantSlug,
  initialDisplayName,
  initialRoleSlug,
  roleOptions,
}: UserEditFormProps) {
  const boundAction = updateUserAction.bind(null, userId);
  const [state, action, pending] = useActionState<UpdateUserActionResult, FormData>(
    boundAction,
    { kind: "idle" },
  );

  // The current role may not be in the tenant's option set (legacy /
  // multi-role rows). Default the select to it if present, else the
  // first option.
  const defaultRole =
    roleOptions.find((r) => r.slug === initialRoleSlug)?.slug ??
    roleOptions[0]?.slug ??
    "";

  return (
    <form action={action} className="space-y-8">
      <ReadOnlyField label="Email" value={email} />
      <ReadOnlyField
        label="Tenant"
        value={`${tenantName} (${tenantSlug})`}
        helper="Moving a user to another tenant isn't supported here — it re-parents their role assignments. Flagged for a follow-up."
      />

      <Field label="Full name" htmlFor="user-display-name">
        <input
          id="user-display-name"
          name="displayName"
          type="text"
          autoComplete="off"
          defaultValue={initialDisplayName ?? ""}
          className={INPUT_CLASS}
        />
      </Field>

      <Field label="Role" htmlFor="user-role">
        <select
          id="user-role"
          name="roleSlug"
          required
          defaultValue={defaultRole}
          className={SELECT_CLASS}
        >
          {roleOptions.map((r) => (
            <option key={r.slug} value={r.slug}>
              {r.label}
            </option>
          ))}
        </select>
      </Field>

      {state.kind !== "idle" ? (
        <p role="alert" className="border border-red bg-red/5 px-4 py-3 text-sm text-red">
          {state.message}
        </p>
      ) : null}

      <div className="flex items-center justify-between border-t border-[color:var(--color-border-default)] pt-6">
        <Link
          href={`/admin/users/${userId}`}
          className="text-xs uppercase tracking-[0.2em] text-[color:var(--color-text-secondary)] hover:text-navy"
        >
          ← Cancel
        </Link>
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center rounded-sm border border-navy bg-navy px-4 py-2 text-xs font-medium uppercase tracking-[0.14em] text-paper transition-opacity duration-[120ms] ease-out hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save changes"}
        </button>
      </div>
    </form>
  );
}

const INPUT_CLASS =
  "w-full border border-stone-200 bg-paper px-3 py-2 text-sm text-navy placeholder:text-[color:var(--color-text-tertiary)] transition-colors duration-[120ms] ease-out focus:border-navy focus:bg-stone-100 focus:outline-none";

const SELECT_CLASS = `${INPUT_CLASS} cursor-pointer`;

function Field({
  label,
  htmlFor,
  children,
}: {
  readonly label: string;
  readonly htmlFor: string;
  readonly children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <label
        htmlFor={htmlFor}
        className="block text-xs font-medium uppercase tracking-[0.14em] text-navy"
      >
        {label}
      </label>
      {children}
    </div>
  );
}

function ReadOnlyField({
  label,
  value,
  helper,
}: {
  readonly label: string;
  readonly value: string;
  readonly helper?: string;
}) {
  return (
    <div className="space-y-2">
      <p className="block text-xs font-medium uppercase tracking-[0.14em] text-[color:var(--color-text-secondary)]">
        {label}
      </p>
      <p className="text-sm text-navy">{value}</p>
      {helper ? (
        <p className="text-xs text-[color:var(--color-text-secondary)]">{helper}</p>
      ) : null}
    </div>
  );
}
