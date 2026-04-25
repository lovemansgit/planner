import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import importPlugin from "eslint-plugin-import";

// The eight modules per plan §3.3. Boundaries between them are enforced
// by the rules below: each module exports only via its own index.ts, and
// no module imports another module's internal files.
const MODULES = [
  "audit",
  "consignees",
  "credentials",
  "identity",
  "integration",
  "subscriptions",
  "tasks",
  "webhooks",
];

// Generate one zone per directional module pair (8 × 7 = 56 zones).
// Each zone says: code inside module X cannot import internal files of
// module Y; only Y's index.ts is reachable.
const moduleBoundaryZones = MODULES.flatMap((target) =>
  MODULES.filter((from) => from !== target).map((from) => ({
    target: `./src/modules/${target}/**/*`,
    from: `./src/modules/${from}/**/*`,
    except: [`./src/modules/${from}/index.ts`, `./src/modules/${from}/index.tsx`],
    message: `Module '${target}' must import from '${from}' via its public index.ts only — plan §3.4 and §11.3 non-negotiable.`,
  }))
);

const config = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    files: ["src/**/*.{ts,tsx,js,mjs}"],
    plugins: { import: importPlugin },
    settings: {
      "import/resolver": {
        typescript: {
          project: "./tsconfig.json",
        },
        node: true,
      },
    },
    rules: {
      // Forbid circular imports between modules. Cycles indicate a bad
      // module boundary (plan §3.4: "If B also imports A, you have a
      // bad boundary"). External (node_modules) cycles are out of scope.
      "import/no-cycle": ["error", { maxDepth: 10, ignoreExternal: true }],

      // Modules consume each other only via index.ts. Backstop for the
      // §11.3 "no module imports another module's internal files"
      // non-negotiable.
      "import/no-restricted-paths": ["error", { zones: moduleBoundaryZones }],

      // No raw `db` value imports — every tenant-scoped DB access goes
      // through `withTenant(tenantId, ...)` or `withServiceRole(reason, ...)`.
      // The wrappers and the `db` singleton land in commit 7
      // (src/shared/db.ts) per resolutions R-3; this rule fails closed
      // until then.
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@/shared/db",
              importNames: ["db"],
              message:
                "Do not import `db` directly. Use `withTenant(tenantId, async (tx) => ...)` or `withServiceRole(reason, async (tx) => ...)` from @/shared/db. See plan-resolutions R-3.",
            },
          ],
          patterns: [
            {
              group: ["**/shared/db", "**/shared/db.ts", "**/shared/db.js"],
              importNames: ["db"],
              message:
                "Do not import `db` directly via relative path. Use `withTenant` or `withServiceRole`. See plan-resolutions R-3.",
            },
          ],
        },
      ],
    },
  },
  // db.ts itself is the canonical home of `db` and may reference it
  // internally. Migrations and seed scripts also legitimately bypass
  // RLS via the service-role pattern.
  {
    files: ["src/shared/db.ts", "src/shared/db.tsx", "supabase/migrations/**/*", "scripts/**/*"],
    rules: {
      "no-restricted-imports": "off",
    },
  },
];

export default config;
