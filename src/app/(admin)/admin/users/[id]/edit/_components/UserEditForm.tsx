// Item 2 — UserEditForm. Client component: edits a user's full name and
// role. Role options are fixed at load (they derive from the user's
// tenant, which is NOT editable here). Tenant + email render read-only
// for context. useActionState wires submit → the bound server action;
// on success the action redirects to the detail view.
//
// Phase 10 · Batch B4 — the editable Full name + Role fields adopt the shipped
// Field/Select kit (sentence-case labels, recipe input surface, <Select>). The
// read-only Email/Tenant context rows keep their distinct eyebrow display
// (not editable controls — out of the field/select scope).

"use client";

import Link from "next/link";
import { useActionState } from "react";

import { Button } from "@/components/Button";
import { Field } from "@/components/Field";
import { inputClass } from "@/components/form-field-recipe";
import { Select } from "@/components/Select";

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
        helper="A user belongs to one merchant. To put someone under a different merchant, create a new user there — moving an existing user between merchants isn't supported."
      />

      <Field label="Full name" htmlFor="user-display-name">
        <input
          id="user-display-name"
          name="displayName"
          type="text"
          autoComplete="off"
          defaultValue={initialDisplayName ?? ""}
          className={inputClass()}
        />
      </Field>

      <Field label="Role" htmlFor="user-role">
        <Select id="user-role" name="roleSlug" required defaultValue={defaultRole}>
          {roleOptions.map((r) => (
            <option key={r.slug} value={r.slug}>
              {r.label}
            </option>
          ))}
        </Select>
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
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </form>
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
