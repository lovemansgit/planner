// Day-22 Phase 1 forms — top-of-form error rail (server component).
//
// Renders a non-field-scoped form error (e.g. "Slug already exists",
// "You don't have permission to do that"). Field-scoped errors render
// inline via FormField's `error` prop; this component is for the
// "_form" / "conflict" / "forbidden" / "not_found" cases that don't
// belong to one input.
//
// Brand-canon: red/40 hairline border, red/10 wash, text-red copy.
// No shadows, no rounded-lg. role="alert" so assistive tech announces
// on render.
//
// Returns null when `message` is null/undefined — caller can mount
// unconditionally without needing a parent guard.

interface FormErrorProps {
  readonly message: string | null | undefined;
  /** Optional className override for outer wrapper (e.g. mb-6 spacing). */
  readonly className?: string;
}

export function FormError({ message, className }: FormErrorProps) {
  if (!message) return null;
  return (
    <p
      role="alert"
      className={`rounded-sm border border-red/40 bg-red/10 px-3 py-2 text-sm text-red ${className ?? ""}`}
    >
      {message}
    </p>
  );
}
