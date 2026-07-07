# Follow-up — dangling methodology references after the pointer replacement (2026-07-07)

`memory/BUILD-METHODOLOGY.md` was removed in favour of `memory/POINTER.md`
(owner-ordered 7 Jul 2026, PR #667). Two files still reference the deleted
path and are OFF the docs-lane allowlist, so they cannot be fixed in the
docs-lane PR:

- `.claude/agents/reviewer.md:13` — the reviewer's own bootstrap reference.
- `scripts/orchestration/RUNBOOK.md:9` — the orchestration runbook reference.

A separate PR updates both references to `memory/POINTER.md`; by the path
gate it PARKS for Love's sentence (expected — .claude/** and scripts/** are
off-allowlist). Until it merges, sessions reading those files should follow
`memory/POINTER.md` to the canonical repo.
