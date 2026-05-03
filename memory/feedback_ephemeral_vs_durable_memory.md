---
name: Memory has two stores — durable (repo) is canonical, agent-private is ephemeral
description: Surveying ~/Code/planner/memory/ at session start is the first step. The auto-memory location at ~/.claude/projects/.../memory/ is scratch and reloaded each session, NOT the canonical record. Caught Day 5 / T-8 review.
type: feedback
---
**Rule:** There are two memory directories. The repo-tracked one is canonical; the agent-private one is ephemeral working scratch. Always survey the durable store at session start before assuming any "memory" reference points to the auto-loaded location.

**The two stores:**

1. **Durable, canonical, git-tracked** — `~/Code/planner/memory/` (in this project). The repo's `memory/MEMORY.md` is explicit on which one is which:
   > "Durable memory notes live in this directory and are tracked in git. Private agent memory at `~/.claude/projects/.../memory/` is for ephemeral working notes only."

2. **Agent-private, ephemeral, auto-loaded** — `~/.claude/projects/-Users-lovemans-Code-planner/memory/`. This is what the auto-memory system loads on session boot. Easy to mistake for the canonical store because (a) the system prompt mentions it, (b) entries from prior sessions persist there, (c) MEMORY.md exists in both locations.

**Why it matters:** Writing a "decision" or "feedback" note to the ephemeral store means the next session may not see it (or may see a stale version), and other engineers reading the repo cannot find it at all. Conversely, *reading* from the ephemeral store as if it were canonical produces stale or incomplete answers — the session-start system reminder shows ephemeral entries, which can mask the durable store's richer content.

**How this surfaced:** Day 5 / T-8 review. I had been treating the agent-private location as canonical for the entire Day-5 session. When Love asked about a specific memory file (`followup_createtask_idempotency.md`), I reported "doesn't exist" — based on the agent-private listing. The file actually existed in the durable store, where it always had. Several Day-5 entries (the no-user-create-delete decision, the no-self-tier-escalation feedback, a misdirected cron-retry append) had landed in the ephemeral store and would have been invisible to the next session and to other engineers reading the repo. They were migrated to durable as part of T-8 review cleanup.

**How to apply:**

- **Session start:** before responding to any memory-referencing prompt, run `ls ~/Code/planner/memory/` and read `~/Code/planner/memory/MEMORY.md`. The durable index is the source of truth for what notes exist.
- **When a brief or message names a memory file:** check the durable store first. If the file isn't there, also check the ephemeral store, but treat ephemeral-only files as transient and surface that fact when responding.
- **When writing a memory note:** if the content is durable (a real decision, a forward-looking feedback rule, a project-state fact), write to the durable store. Use Write tool against `~/Code/planner/memory/<name>.md`. Update `~/Code/planner/memory/MEMORY.md` index. Do NOT write durable content to the agent-private location.
- **When in doubt about scope:** the test is "would a future engineer reading the repo benefit from this?" If yes, durable. If it's purely working scratch for the current session, ephemeral.
- **Ephemeral entries are not deleted automatically.** A misdirected entry in the ephemeral store stays there until manually pruned. When migrating ephemeral → durable, also remove the ephemeral copy (or the now-stale segments of it).

**Anti-pattern that triggered this:** treating the auto-memory system's documentation in the system prompt as definitive. The system prompt mentions the agent-private location and its file format; it does not say "this is the canonical store." The repo's `memory/MEMORY.md` does say which is canonical — and that file is the authoritative source.

**Surfaced and resolved:** Day 5 / T-8, 2026-04-30. Migration of misdirected Day-5 entries to durable + removal of misdirected appends from ephemeral landed as part of T-8 review.
