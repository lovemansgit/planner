#!/usr/bin/env node
// scripts/sandbox-smoke-dedupe-probe.mjs
//
// Empirical idempotency probe — Day 4 / S-8 review.
//
// Purpose: determine SuiteFleet's deduplication behaviour on
// POST /api/tasks when the same customerOrderNumber is submitted
// twice within a short window. Three possible outcomes:
//
//   (a) Second POST returns 200 with SAME id + awb → SF dedupes ✓
//   (b) Second POST returns 200 with DIFFERENT id + awb → SF creates a
//       duplicate ✗ (retry-on-uncertainty unsafe; idempotency hardening
//       required before pilot)
//   (c) Second POST returns 4xx (likely 409 Conflict) → SF rejects
//       duplicate ✓ (idempotency gap closed differently)
//
// Usage (from repo root, with .env.local sourced):
//   set -a && source .env.local && set +a
//   node scripts/sandbox-smoke-dedupe-probe.mjs
//
// Never logs credentials or tokens. Logs IDs, statuses, and full
// second-response body so the outcome is verifiable.

const BASE = "https://api.suitefleet.com";

function need(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing env var: ${name}`);
    process.exit(1);
  }
  return v;
}

async function main() {
  const username = need("SUITEFLEET_SANDBOX_USERNAME");
  const password = need("SUITEFLEET_SANDBOX_PASSWORD");
  const clientId = need("SUITEFLEET_SANDBOX_CLIENT_ID");
  const customerId = parseInt(need("SUITEFLEET_SANDBOX_CUSTOMER_ID"), 10);

  const authUrl = new URL(`${BASE}/api/auth/authenticate`);
  authUrl.searchParams.set("username", username);
  authUrl.searchParams.set("password", password);
  const authRes = await fetch(authUrl, {
    method: "POST",
    headers: { Clientid: clientId, Accept: "application/json" },
  });
  if (!authRes.ok) {
    console.error(`auth failed: status=${authRes.status}`);
    process.exit(2);
  }
  const auth = await authRes.json();

  const orderNumber = `DEDUPE-PROBE-${Date.now()}`;
  const body = {
    codAmount: 0,
    consignee: {
      name: "Dedupe Probe Consignee",
      contactPhone: "+971500000003",
      location: {
        addressLine1: "Probe St 1",
        city: "Dubai",
        district: "Jumeirah 3",
        countryCode: "AE",
        latitude: 25.1972,
        longitude: 55.2744,
        addressCode: "AXD",
        contactPhone: "+971500000003",
      },
    },
    creationSource: "API",
    customerId,
    customerOrderNumber: orderNumber,
    referenceNumber: `REF-${orderNumber}`,
    deliverToCustomerOnly: true,
    deliveryDate: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    deliveryStartTime: "09:00:00",
    deliveryEndTime: "12:00:00",
    deliveryType: "STANDARD",
    deliveryInformation: { paymentMethod: "PrePaid" },
    notes: "Dedupe probe — same body submitted twice",
    shipFrom: {
      addressLine1: "Warehouse A",
      city: "Dubai",
      countryCode: "AE",
      latitude: 25.0,
      longitude: 55.0,
      contactPhone: "+971500000003",
    },
    signatureRequired: false,
    smsNotifications: false,
    status: "ORDERED",
    totalDeclaredGrossWeight: 1.5,
    totalShipmentQuantity: 1,
    totalShipmentValueAmount: 100,
    type: "DELIVERY",
    validDeliveryTime: true,
    volume: 0,
  };

  const taskHeaders = {
    Authorization: `Bearer ${auth.accessToken}`,
    Clientid: clientId,
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  console.log(`[${new Date().toISOString()}] order_number=${orderNumber}`);
  console.log(`[${new Date().toISOString()}] step=first_post start`);
  const first = await fetch(`${BASE}/api/tasks`, {
    method: "POST",
    headers: taskHeaders,
    body: JSON.stringify(body),
  });
  const firstText = await first.text();
  let firstJson = null;
  try {
    firstJson = JSON.parse(firstText);
  } catch {
    /* leave null */
  }
  console.log(
    `[${new Date().toISOString()}] step=first_post done status=${first.status} ` +
      `id=${firstJson?.id ?? "?"} awb=${firstJson?.awb ?? "?"}`,
  );

  console.log(`[${new Date().toISOString()}] sleep 1000ms`);
  await new Promise((r) => setTimeout(r, 1000));

  console.log(`[${new Date().toISOString()}] step=second_post start (identical body)`);
  const second = await fetch(`${BASE}/api/tasks`, {
    method: "POST",
    headers: taskHeaders,
    body: JSON.stringify(body),
  });
  const secondText = await second.text();
  let secondJson = null;
  try {
    secondJson = JSON.parse(secondText);
  } catch {
    /* leave null */
  }
  console.log(
    `[${new Date().toISOString()}] step=second_post done status=${second.status} ` +
      `id=${secondJson?.id ?? "?"} awb=${secondJson?.awb ?? "?"}`,
  );

  console.log("");
  console.log("=== OUTCOME ===");

  const firstId = firstJson?.id;
  const secondId = secondJson?.id;
  const firstAwb = firstJson?.awb;
  const secondAwb = secondJson?.awb;

  if (second.status >= 400) {
    console.log(`Result: REJECTED — second POST returned ${second.status}`);
    console.log(`SuiteFleet rejects duplicate customerOrderNumber. Idempotency gap closed.`);
    console.log(`Second response body (first 500 chars): ${secondText.slice(0, 500)}`);
  } else if (firstId === secondId && firstAwb === secondAwb) {
    console.log(`Result: DEDUPED — same id (${firstId}) and same awb (${firstAwb})`);
    console.log(`SuiteFleet dedupes by customerOrderNumber. Retry-on-uncertainty SAFE at wire level.`);
  } else if (firstId !== secondId) {
    console.log(`Result: DUPLICATE CREATED — different ids: ${firstId} vs ${secondId}`);
    console.log(`Different awbs: ${firstAwb} vs ${secondAwb}`);
    console.log(`SuiteFleet does NOT dedupe. Retry-on-uncertainty UNSAFE.`);
    console.log(`Mitigation required: Idempotency-Key header probe OR disable retry-on-uncertain-failure.`);
  } else {
    console.log(`Result: AMBIGUOUS — investigate response bodies`);
    console.log(`First : ${firstText.slice(0, 500)}`);
    console.log(`Second: ${secondText.slice(0, 500)}`);
  }
}

main().catch((e) => {
  console.error("probe failed:", e.message);
  process.exit(99);
});
