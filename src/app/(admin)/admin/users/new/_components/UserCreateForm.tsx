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
// Phase 10 · Batch B4 — adopts the shipped Field/Select kit: the local
// children-based Field is replaced by <Field> (sentence-case labels per D2),
// inputs move to inputClass(), and the tenant/role <select>s become <Select>.
// The controlled-select behaviour (tenant drives the role options) is preserved.

"use client";

import Link from "next/link";
import { useActionState, useMemo, useState } from "react";

import { Button } from "@/components/Button";
import { Field } from "@/components/Field";
import { inputClass } from "@/components/form-field-recipe";
import { Select } from "@/components/Select";

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
          className={inputClass()}
        />
      </Field>

      <Field label="Full name" htmlFor="user-full-name">
        <input
          id="user-full-name"
          name="fullName"
          type="text"
          autoComplete="off"
          className={inputClass()}
        />
      </Field>

      <Field
        label="Temporary password"
        htmlFor="user-password"
        help="At least 8 characters. Share via 1Password; the user can change it after first login."
      >
        <input
          id="user-password"
          name="password"
          type="text"
          required
          minLength={8}
          autoComplete="off"
          className={inputClass()}
        />
      </Field>

      <Field label="Tenant" htmlFor="user-tenant">
        <Select
          id="user-tenant"
          name="tenantId"
          required
          value={selectedTenantId}
          onChange={(e) => {
            setSelectedTenantId(e.target.value);
            setSelectedRoleSlug("");
          }}
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
        </Select>
      </Field>

      <Field label="Role" htmlFor="user-role">
        <Select
          id="user-role"
          name="roleSlug"
          required
          value={effectiveRoleSlug}
          onChange={(e) => setSelectedRoleSlug(e.target.value)}
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
        </Select>
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
        <Button type="submit" variant="primary" disabled={pending || tenantOptions.length === 0}>
          {pending ? "Creating…" : "Create user"}
        </Button>
      </div>
    </form>
  );
}
