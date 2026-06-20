#!/usr/bin/env node
// scripts/diag-p1-status-webhook-readonly.mjs
//
// P1 SF-status-webhook diagnostic — STRICTLY READ-ONLY (SELECT only).
// No INSERT/UPDATE/DELETE, no DDL, no SF API calls, no mutation.
//
// Two questions (both read-only), per Love's continue-instruction:
//   Q1 (master-webhook verdict): open FULL raw_payload of recent
//       TASK_HAS_BEEN_UPDATED events for the real moving/stuck tasks and
//       scan for ANY driver-status/state field. If present -> Planner is
//       ignoring it (real bug). If absent -> master payload carries only
//       field-edits (no bug; separate subscriptions are the right fix).
//       Prints a REDACTED sample (PII values masked; status/state shown).
//   Q2 (target list): enumerate affected merchant tenants (slug + name)
//       + their CREATED+pushed tasks (AWBs), grouped by tenant, for
//       Aqib's SF-portal fix and the (parked) backfill set.
//
// PII posture: every value is redacted to "<redacted:type>" EXCEPT an
// allowlist of non-personal structural/decision fields (action, awb, id,
// dates, type, and ANY key containing 'status'/'state'). Merchant
// slug+name ARE shown (business identifiers needed for the target list).
import postgres from "postgres";

const dbUrl = process.env.SUPABASE_DATABASE_URL;
if (!dbUrl) { console.error("missing SUPABASE_DATABASE_URL"); process.exit(1); }
const sql = postgres(dbUrl, { max: 1, prepare: false });

const SHOW = new Set([
  "action","awb","id","type","deliverytype","shipmentcategory","deliverydate",
  "deliverystarttime","deliveryendtime","eventtimestamp","timestamp","createddate",
  "pickeduptime","highvaluetask","signaturerequired","ageverificationrequired",
  "remotearea","numberofattempts","bagsreturned","icepacksreturned",
  "taskassettrackingenabled","defaulttaskassettype","hangers","volume",
  "totalshipmentquantity",
]);
const isShown = (k) => { const l=String(k).toLowerCase(); return SHOW.has(l)||l.includes("status")||l.includes("state"); };

// recursively collect any key matching /status|state/i with its path+value
function findStatusFields(obj, path="$", out=[]) {
  if (obj == null || typeof obj !== "object") return out;
  for (const [k,v] of Object.entries(obj)) {
    const p = `${path}.${k}`;
    if (/status|state/i.test(k)) out.push({ path: p, value: (v==null||typeof v!=="object") ? v : `<${Array.isArray(v)?"array":"object"}>` });
    if (v && typeof v === "object") findStatusFields(v, p, out);
  }
  return out;
}
function redact(obj) {
  if (obj == null || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(redact);
  const o = {};
  for (const [k,v] of Object.entries(obj)) {
    if (v && typeof v === "object") o[k] = redact(v);
    else o[k] = isShown(k) ? v : `<redacted:${v===null?"null":typeof v}>`;
  }
  return o;
}

try {
  await sql.unsafe("BEGIN; SET TRANSACTION READ ONLY").catch(()=>{}); // best-effort; all stmts are SELECT regardless

  // The real moving/stuck tasks surfaced in the first diagnostic pass.
  const STUCK_AWBS = [
    "MLU-66453284","MLU-83422184","MLU-97015852","MLU-08141461","MLU-96777243",
    "MPL-55380019","MPL-00594117",
  ];

  console.log("===== Q1: TASK_HAS_BEEN_UPDATED master-webhook verdict =====");
  const huRows = await sql`
    SELECT suitefleet_task_id, event_timestamp::text ets, raw_payload
    FROM webhook_events
    WHERE action='TASK_HAS_BEEN_UPDATED' AND suitefleet_task_id = ANY(${STUCK_AWBS})
    ORDER BY received_at DESC LIMIT 12`;
  console.log(`  opened ${huRows.length} TASK_HAS_BEEN_UPDATED payloads for the stuck tasks`);
  let anyStatus = false;
  for (const r of huRows) {
    const sf = findStatusFields(r.raw_payload);
    if (sf.length) anyStatus = true;
    console.log(`  - awb=${r.suitefleet_task_id} ts=${r.ets} topKeys=[${Object.keys(r.raw_payload).join(",")}]`);
    console.log(`      status/state fields found: ${sf.length ? JSON.stringify(sf) : "NONE"}`);
  }
  console.log(`\n  VERDICT: TASK_HAS_BEEN_UPDATED payloads ${anyStatus ? "CONTAIN" : "DO NOT contain"} a driver-status/state field.`);

  if (huRows.length) {
    console.log("\n  --- one REDACTED sample TASK_HAS_BEEN_UPDATED payload (PII masked; status/state shown) ---");
    console.log(JSON.stringify(redact(huRows[0].raw_payload), null, 2));
  }

  console.log("\n===== contrast: one REDACTED real TASK_STATUS_UPDATED_TO_* payload (where status LIVES) =====");
  const stRow = await sql`
    SELECT action, suitefleet_task_id, raw_payload FROM webhook_events
    WHERE action LIKE 'TASK_STATUS_UPDATED_TO_%' AND suitefleet_task_id NOT LIKE '%-MISSING'
      AND suitefleet_task_id NOT LIKE '%-SKIPPED' AND jsonb_typeof(raw_payload->'status') IS NOT NULL
    ORDER BY received_at DESC LIMIT 1`;
  if (stRow.length) {
    console.log(`  action=${stRow[0].action} awb=${stRow[0].suitefleet_task_id}`);
    console.log(`  status/state fields: ${JSON.stringify(findStatusFields(stRow[0].raw_payload))}`);
    console.log(JSON.stringify(redact(stRow[0].raw_payload), null, 2));
  } else {
    console.log("  (no rich status payload with a top-level status field found)");
  }

  console.log("\n===== Q2: affected merchant tenants + stuck tasks (grouped) =====");
  const grouped = await sql`
    SELECT te.slug, te.name, t.external_tracking_number awb, t.external_id extid,
           t.delivery_date::text dd,
           (SELECT string_agg(DISTINCT w.action, ',' ORDER BY w.action) FROM webhook_events w
              WHERE w.tenant_id=t.tenant_id AND w.suitefleet_task_id=t.external_tracking_number) actions
    FROM tasks t JOIN tenants te ON te.id = t.tenant_id
    WHERE t.internal_status='CREATED' AND t.pushed_to_external_at IS NOT NULL
      AND t.external_tracking_number IS NOT NULL
      AND EXISTS (SELECT 1 FROM webhook_events w WHERE w.tenant_id=t.tenant_id
                  AND w.suitefleet_task_id=t.external_tracking_number)
    ORDER BY te.slug, t.delivery_date`;
  let curr = null;
  for (const r of grouped) {
    if (r.slug !== curr) { curr = r.slug; console.log(`\n  TENANT slug=${r.slug} name="${r.name}"`); }
    console.log(`    awb=${r.awb} extid=${r.extid} dd=${r.dd} actions=[${r.actions ?? ""}]`);
  }
  console.log(`\n  (tasks above are CREATED+pushed WITH webhook receipts; the SF-fetch backfill decides which truly advanced)`);

  console.log("\n===== Q3: distinct SF `status` field vocabulary (for the eventual status-VALUE map) =====");
  const vocab = await sql`
    SELECT raw_payload->>'status' AS status_value, count(*) n,
           string_agg(DISTINCT action, ',' ORDER BY action) actions
    FROM webhook_events
    WHERE raw_payload ? 'status'
    GROUP BY raw_payload->>'status' ORDER BY n DESC`;
  for (const r of vocab) console.log(`  status="${r.status_value}"  n=${r.n}  seen_on_actions=[${r.actions}]`);
} catch (e) {
  console.error("DIAG ERROR:", e.message);
} finally {
  await sql.end();
}
