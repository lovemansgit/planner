// Read-only SF-sandbox task-activities reader for the Day-52 proving
// pass (Love-authorized: same read-only pattern as the Day-21 probes).
// Usage: node scripts/uat-sf-task-activities.mjs <AWB> [<AWB>...]
// Auths via SUITEFLEET_SANDBOX_* from the environment and GETs
// /api/tasks/awb/{awb}/task-activities for each AWB. Prints status +
// a compact activity list. NO writes.

const SF_API_BASE = process.env.SF_API_BASE ?? "https://api.suitefleet.com";

function need(name) {
  const v = process.env[name];
  if (!v) { console.error(`missing env: ${name}`); process.exit(2); }
  return v;
}

const awbs = process.argv.slice(2);
if (awbs.length === 0) { console.error("usage: uat-sf-task-activities.mjs <AWB>..."); process.exit(2); }

const username = need("SUITEFLEET_SANDBOX_USERNAME");
const password = need("SUITEFLEET_SANDBOX_PASSWORD");
const clientId = need("SUITEFLEET_SANDBOX_CLIENT_ID");

const authUrl = new URL(`${SF_API_BASE}/api/auth/authenticate`);
authUrl.searchParams.set("username", username);
authUrl.searchParams.set("password", password);
const authRes = await fetch(authUrl, { method: "POST", headers: { Clientid: clientId, Accept: "application/json" } });
if (!authRes.ok) { console.error(`auth failed: ${authRes.status}`); process.exit(4); }
const auth = await authRes.json();
const token = auth.accessToken ?? auth.token ?? auth.access_token;
console.log(`auth ok (token_len=${String(token).length})`);

for (const awb of awbs) {
  const url = `${SF_API_BASE}/api/tasks/awb/${encodeURIComponent(awb)}/task-activities`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Clientid: clientId, Accept: "application/json" } });
  const bodyText = await res.text();
  let summary = bodyText.slice(0, 400);
  try {
    const body = JSON.parse(bodyText);
    const list = Array.isArray(body) ? body : body.content ?? body.activities ?? body.data ?? [];
    if (Array.isArray(list)) {
      summary = list
        .map((a) => {
          const when = a.createdAt ?? a.timestamp ?? a.date ?? a.created_date ?? "?";
          const what = a.action ?? a.activity ?? a.status ?? a.type ?? JSON.stringify(a).slice(0, 60);
          const note = a.note ?? a.notes ?? a.comment ?? "";
          return `    ${when}  ${what}${note ? `  note=${JSON.stringify(note).slice(0, 80)}` : ""}`;
        })
        .join("\n");
      summary = `${list.length} activities\n${summary}`;
    }
  } catch {
    // non-JSON body — raw slice already in summary
  }
  console.log(`\n=== ${awb} → HTTP ${res.status}\n${summary}`);
}
