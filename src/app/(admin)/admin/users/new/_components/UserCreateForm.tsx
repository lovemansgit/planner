// Day-24 — UserCreateForm. Client component because the role
// dropdown re-renders depending on which tenant the operator picked
// (transcorp tenant → transcorp-sysadmin only; merchant tenant →
// tenant-admin or ops-manager). useActionState wires the submit to
// the server action and exposes typed error variants for inline
// rendering.
//
// Validation discipline: client-side enforcement is UX polish only;
// the server action repeats every check (email format, password
// length, role/tenant compatibility) because the action is the
// actual authority. Form-level errors come back via the action result
// and render inline.
//
// Brand-canon form styling: hairline stone-200 fields at rest, navy
// focus border, 120ms ease-out, sentence-case labels, no shadow.
// Match the existing /admin/merchants/new form posture.

"use client";

import Link from "next/link";
import { useActionState, useMemo, useState } from "react";

import {
  createUserAction,
  type CreateUserActionResult,
} from "../_actions";

interface TenantOption {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly kind: "transcorp" | "merchant";
}

interface RoleOption {
  readonly slug: string;
  readonly label: string;
}

const TRANSCORP_ROLE_OPTIONS: readonly RoleOption[] = [
  { slug: "transcorp-sysadmin", label: "Transcorp Sysadmin" },
];

const MERCHANT_ROLE_OPTIONS: readonly RoleOption[] = [
  { slug: "tenant-admin", label: "Tenant Admin" },
  { slug: "ops-manager", label: "Ops Manager" },
];

function roleOptionsFor(tenant: TenantOption | null): readonly RoleOption[] {
  if (tenant === null) return [];
  return tenant.kind === "transcorp" ? TRANSCORP_ROLE_OPTIONS : MERCHANT_ROLE_OPTIONS;
}

export function UserCreateForm({
  tenantOptions,
}: {
  readonly tenantOptions: readonly TenantOption[];
}) {
  const [selectedTenantId, setSelectedTenantId] = useState<string>(
    tenantOptions[0]?.id ?? "",
  );
  const [selectedRoleSlug, setSelectedRoleSlug] = useState<string>("");

  const selectedTenant = useMemo(
    () => tenantOptions.find((t) => t.id === selectedTenantId) ?? null,
    [tenantOptions, selectedTenantId],
  );
  const roleOptions = useMemo(() => roleOptionsFor(selectedTenant), [selectedTenant]);

  const effectiveRoleSlug =
    roleOptions.find((r) => r.slug === selectedRoleSlug)?.slug ??
    roleOptions[0]?.slug ??
    "";

  const [state, action, pending] = useActionState<CreateUserActionResult, FormData>(
    createUserAction,
    { kind: "idle" },
  );

  return (
    <form action={action} className="space-y-8">
      <Field label="Email" htmlFor="user-email">
        <input
          id="user-email"
          name="email"
          type="email"
          required
          autoComplete="off"
          className={INPUT_CLASS}
        />
      </Field>

      <Field label="Full name" htmlFor="user-full-name">
        <input
          id="user-full-name"
          name="fullName"
          type="text"
          autoComplete="off"
          className={INPUT_CLASS}
        />
      </Field>

      <Field
        label="Temporary password"
        htmlFor="user-password"
        helper="At least 8 characters. Share via 1Password; the user can change it after first login."
      >
        <input
          id="user-password"
          name="password"
          type="text"
          required
          minLength={8}
          autoComplete="off"
          className={INPUT_CLASS}
        />
      </Field>

      <Field label="Tenant" htmlFor="user-tenant">
        <select
          id="user-tenant"
          name="tenantId"
          required
          value={selectedTenantId}
          onChange={(e) => {
            setSelectedTenantId(e.target.value);
            setSelectedRoleSlug("");
          }}
          className={SELECT_CLASS}
        >
          {tenantOptions.length === 0 ? (
            <option value="">No tenants configured</option>
          ) : (
            tenantOptions.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.slug})
              </option>
            ))
          )}
        </select>
      </Field>

      <Field label="Role" htmlFor="user-role">
        <select
          id="user-role"
          name="roleSlug"
          required
          value={effectiveRoleSlug}
          onChange={(e) => setSelectedRoleSlug(e.target.value)}
          className={SELECT_CLASS}
        >
          {roleOptions.length === 0 ? (
            <option value="">Pick a tenant first</option>
          ) : (
            roleOptions.map((r) => (
              <option key={r.slug} value={r.slug}>
                {r.label}
              </option>
            ))
          )}
        </select>
      </Field>

      {state.kind !== "idle" ? (
        <p
          role="alert"
          className="border border-red bg-red/5 px-4 py-3 text-sm text-red"
        >
          {state.message}
        </p>
      ) : null}

      <div className="flex items-center justify-between border-t border-[color:var(--color-border-default)] pt-6">
        <Link
          href="/admin/users"
          className="text-xs uppercase tracking-[0.2em] text-[color:var(--color-text-secondary)] hover:text-navy"
        >
          ← Cancel
        </Link>
        <button
          type="submit"
          disabled={pending || tenantOptions.length === 0}
          className="inline-flex items-center rounded-sm border border-navy bg-navy px-4 py-2 text-xs font-medium uppercase tracking-[0.14em] text-paper transition-opacity duration-[120ms] ease-out hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? "Creating…" : "Create user"}
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
  helper,
  children,
}: {
  readonly label: string;
  readonly htmlFor: string;
  readonly helper?: string;
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
      {helper ? (
        <p className="text-xs text-[color:var(--color-text-secondary)]">{helper}</p>
      ) : null}
    </div>
  );
}
