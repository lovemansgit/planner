# Sandbox Cleanup — BACKUP RUNBOOK (for Love to run)

**What this does:** writes ONE file containing every row the delete will remove — the 1,759
junk tenants on `transcorpsb` + all their child rows across 22 tables — as runnable `INSERT`
statements (so it can be replayed to restore). Read-only: it changes nothing.

**Why psql (not the SQL editor):** the Supabase SQL editor truncates CSV exports at ~1,000
rows; this backup is ~20,000 rows. `psql` streams the whole thing with no cap.

**Safety:** your database connection string contains your password. **Never paste it into
chat, a file you commit, or share it.** The steps below keep it on your machine only (typed
into a hidden prompt, not saved to your shell history).

You are on a Mac. Everything below is copy-paste into the **Terminal** app
(press ⌘+Space, type `Terminal`, Enter).

---

## Step 1 — Do you have `psql`? (one check)

Paste this and press Enter:

```
psql --version
```

- If it prints something like `psql (PostgreSQL) 16.2` → **skip to Step 2.**
- If it says `command not found` → install it (needs Homebrew):

```
brew install libpq
echo 'export PATH="/opt/homebrew/opt/libpq/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
```

Then run `psql --version` again — it should now print a version.
(If you have an older Intel Mac, use `/usr/local/opt/libpq/bin` in the line above. If you
don't have Homebrew at all, install the free **Postgres.app** from https://postgresapp.com —
it includes `psql` — then re-open Terminal and run `psql --version`.)

---

## Step 2 — Get your connection string from Supabase

1. Open the Supabase dashboard → your project (**qdotjmwqbyzldfuxphei**).
2. Click **Settings** (gear, bottom-left) → **Database**.
3. Find **Connection string**. Click the **Session pooler** tab (not "Direct connection" —
   the pooler works on all networks).
4. Click **Copy**. It looks like:
   `postgresql://postgres.qdotjmwqbyzldfuxphei:[YOUR-PASSWORD]@aws-0-<region>.pooler.supabase.com:5432/postgres`
5. It contains `[YOUR-PASSWORD]` as a placeholder. Replace that with your **database
   password**. If you don't know it: same page → **Database password** → **Reset database
   password** (note: resetting changes it everywhere it's used). Keep the final string handy
   for Step 3 — **do not paste it here or into any file.**

---

## Step 3 — Run the backup (3 lines)

In Terminal:

```
cd /Users/lovemans/Code/planner
```

Now type the connection string into a **hidden** prompt (nothing shows as you paste; it is
NOT saved to history):

```
read -rs -p "Paste your Session-pooler connection string, then press Enter: " SUPABASE_DB_URL; echo; export SUPABASE_DB_URL
```

Then run the backup (this is the one command that does the work):

```
psql "$SUPABASE_DB_URL" -At -f memory/plans/sandbox-cleanup/backup-query.sql > "sandbox-cleanup-backup-$(date +%Y-%m-%d).sql"
```

It should finish in a few seconds with **no output** (silence = good; any red error text =
something's wrong, stop and send me the error — not the connection string).

---

## Step 4 — Confirm success (eyeball two things)

**(a) The file exists and isn't empty:**

```
ls -lh sandbox-cleanup-backup-*.sql
```

You want a size bigger than 0 (expect a few MB).

**(b) The row count looks right (~20,000):**

```
wc -l sandbox-cleanup-backup-*.sql
```

That prints a line count ≈ the number of backed-up rows. Cross-check it against the exact
expected number:

```
psql "$SUPABASE_DB_URL" -At -f memory/plans/sandbox-cleanup/backup-rowcount.sql
```

This prints one number (the total rows the backup should contain, ~20k — same as Stage-A
Query E). The `wc -l` count should be that number or just slightly higher (a few rows with
embedded line breaks count as 2 lines — harmless).

**(c) Optional — peek at the first and last lines** (should start with `INSERT INTO tenants`
and end with `INSERT INTO audit_events` — i.e. parents first, children last):

```
head -2 sandbox-cleanup-backup-*.sql ; echo "..." ; tail -2 sandbox-cleanup-backup-*.sql
```

When done, clear the connection string from this Terminal session:

```
unset SUPABASE_DB_URL
```

**Tell me: the file size, and both numbers (`wc -l` and the expected count).** Once they
match, we move to the delete DRY-RUN.

---

## Move the file somewhere safe

The backup file is in `/Users/lovemans/Code/planner/`. Keep it until the cleanup is done and
verified. For a tidy record you can move it into the handoffs folder:

```
mkdir -p memory/handoffs && mv sandbox-cleanup-backup-*.sql memory/handoffs/
```

---

## RESTORE (break-glass only — do NOT run now)

If we ever need to put the rows back, this replays the file in one all-or-nothing transaction
(parents are inserted before children, and `INSERT` is allowed on the append-only tables):

```
psql "$SUPABASE_DB_URL" -1 -f memory/handoffs/sandbox-cleanup-backup-YYYY-MM-DD.sql
```

Restore is itself a live-DB action and needs its own named go-ahead from you. It is not part
of the backup step.

---

### Notes
- The backup captures **only** the 1,759 junk tenants (same frozen predicate as the delete:
  on `transcorpsb`, 8-hex slug, not in the 8 real-merchant slugs). The 11 real Sandbox
  tenants are **not** in it (and can't be — they have no 8-hex run).
- Read-only: `backup-query.sql` only `SELECT`s; the `INSERT` text lives inside the file it
  writes, for restore. Running it cannot change the database.
- The connection string never leaves your machine: it's typed into a hidden prompt and used
  only as the `$SUPABASE_DB_URL` variable in this Terminal session.
