#!/usr/bin/env node
// scripts/create-qstash-asset-poll-schedule.mjs
//
// One-time registration of the 30-minute asset-tracking poll schedule
// (Day-54 P1, bag-tracking lane). Run ONCE on Love's go AFTER the lane
// merges and promotes — the schedule POSTs
// ${PUBLIC_BASE_URL}/api/cron/asset-tracking-poll, which must exist in
// production first.
//
// Idempotent: QStash dedupes by scheduleId when provided; re-running
// upserts the same schedule instead of stacking duplicates.
//
// Cost posture (verified 2026-06-12, upstash.com/pricing/qstash): free
// tier = 1,000 messages/day + 10 active schedules; this schedule
// consumes 48 messages/day. $0 at this volume per Love's constraint.
//
// Usage:
//   set -a && source .env.local && set +a
//   PUBLIC_BASE_URL=https://<prod-domain> node scripts/create-qstash-asset-poll-schedule.mjs

const SCHEDULE_ID = "asset-tracking-poll-30m";
const CRON = "*/30 * * * *";

function need(name) {
  const v = process.env[name];
  if (!v) { console.error(`Missing ${name}`); process.exit(1); }
  return v;
}

async function main() {
  const token = need("QSTASH_TOKEN");
  const baseUrl = need("PUBLIC_BASE_URL").replace(/\/+$/, "");
  const destination = `${baseUrl}/api/cron/asset-tracking-poll`;

  const res = await fetch(
    `https://qstash.upstash.io/v2/schedules/${encodeURIComponent(destination)}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Upstash-Cron": CRON,
        "Upstash-Schedule-Id": SCHEDULE_ID,
        "Upstash-Retries": "0",
      },
    },
  );

  const body = await res.text();
  console.log(`status=${res.status} body=${body}`);
  if (!res.ok) process.exit(2);
  console.log(`schedule ${SCHEDULE_ID} registered: ${CRON} -> ${destination}`);
}

main().catch((e) => { console.error(e); process.exit(99); });
