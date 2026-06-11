# Day-54 runbook — Demo Bistro api_key wire proof (Love executes; nothing runs before your clearance)

**Gate:** this runbook executes ONLY after your clearance sentence for the Day-54 parked pair (#387 plan + the code-PR) AND the migration-0030 apply authorization. Tomorrow's first Ops UAT does not depend on any step here.

**Merchant:** Demo Bistro — tenant `29502ac3-1c3b-460c-9125-e87c7dae4047`, sandbox region `transcorpsb`, SF customer code 591. Every other merchant stays OAuth untouched (your ruling 5).

## Your part (two screens, ~2 minutes)

1. **Create the Client Credentials on the SF sandbox** (SF OpsPortal, your account): generate the api key + secret key pair for the sandbox client.
2. **Switch the method:** open `https://planner-olive-sigma.vercel.app/admin/merchants/29502ac3-1c3b-460c-9125-e87c7dae4047/credentials` → "Authentication method" panel → **Switch to API Key (Client Credentials)** → confirm. (The confirm copy tells you what happens: stored credentials clear, pushes fail loud until step 3. That in-between state is by design.)
3. **Enter the two secrets** on the same page: API Key into the first field, Secret Key into the second → submit. (Write-only — the page never displays them back.)

## The proof (builder executes on your word, read-only beyond auth)

4. **`loginApiKey` 200 on sandbox wire:** `SF_API_BASE=https://api.suitefleet.com SUITEFLEET_APIKEY_CLIENT_ID=transcorpsb SUITEFLEET_APIKEY_API_KEY=… SUITEFLEET_APIKEY_SECRET_KEY=… node scripts/probe-sf-api-key-auth.mjs` — wait: the probe takes the key values from env; **you paste them into the shell yourself or we run the probe through the resolver path instead** (builder never handles the plaintext — preferred: the builder triggers one Planner-side push/read for Demo Bistro so auth flows through the Vault-stored pair, no plaintext outside the admin screen).
   - **Preferred shape (no plaintext anywhere):** builder runs the read-only SF task-activities script against a Demo Bistro AWB via Planner's own resolver-backed session — auth 200 with `auth_method=api_key` in the logs IS the header-shape proof.
5. **One real authenticated call:** any read (task-activities) on the same session — confirms the token works beyond login.
6. **Refresh-wire observation (closes Q4 on sandbox evidence):** the probe's observation step records whether the OAuth-shaped refresh wire accepts the api_key refresh token. Outcome either way is recorded in `decision_aqib_api_key_auth_header_verified.md` as the Q4 closure.

## Rollback (if the wire rejects)

7. Same credentials page → **Switch to OAuth (username / password)** → confirm (clears the api_key pair) → re-enter the sandbox OAuth username/password → done. Two admin actions; the token cache invalidates automatically on both the flip and the credential write. Demo Bistro is back on the proven path; nothing else ever left it.

## Evidence to bank afterward

- Probe/auth output (tokens redacted) + the Q4 refresh observation → appended to `decision_aqib_api_key_auth_header_verified.md` (append-only).
- The production probe gate inherits the sandbox-verified header shape; production provisioning still waits on your named go.
