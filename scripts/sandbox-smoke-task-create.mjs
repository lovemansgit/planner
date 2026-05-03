#!/usr/bin/env node
// scripts/sandbox-smoke-task-create.mjs
//
// One-off smoke flow against the SuiteFleet sandbox for Day 4 / S-8.
// Runs the brief §11 flow:
//   1. Authenticate via /api/auth/authenticate
//   2. Build a synthetic but plausible task (Dubai address, real-shaped phone)
//   3. POST /api/tasks with Authorization + Clientid headers
//   4. Print AWB / task ID
//
// Usage (from repo root, with .env.local sourced):
//   set -a && source .env.local && set +a
//   node scripts/sandbox-smoke-task-create.mjs
//
// Required env:
//   SUITEFLEET_SANDBOX_USERNAME, SUITEFLEET_SANDBOX_PASSWORD,
//   SUITEFLEET_SANDBOX_CLIENT_ID, SUITEFLEET_SANDBOX_CUSTOMER_ID
//
// Never logs credentials or tokens. Logs only IDs and timestamps.

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

  console.log(`[${new Date().toISOString()}] step=auth start`);
  const authUrl = new URL(`${BASE}/api/auth/authenticate`);
  authUrl.searchParams.set("username", username);
  authUrl.searchParams.set("password", password);
  const authRes = await fetch(authUrl, {
    method: "POST",
    headers: { Clientid: clientId, Accept: "application/json" },
  });
  if (!authRes.ok) {
    console.error(`auth failed: status=${authRes.status}`);
    const txt = await authRes.text();
    console.error(`response (first 200 chars): ${txt.slice(0, 200)}`);
    process.exit(2);
  }
  const auth = await authRes.json();
  console.log(
    `[${new Date().toISOString()}] step=auth ok ` +
    `access_expires_at=${auth.accessTokenExpiration} ` +
    `refresh_expires_at=${auth.refreshTokenExpiration}`,
  );

  const orderNumber = `SMOKE-S8-${Date.now()}`;
  const body = {
    codAmount: 0,
    consignee: {
      name: "S8 Smoke Consignee",
      contactPhone: "+971500000001",
      location: {
        addressLine1: "Villa 1, Beach Road",
        city: "Dubai",
        district: "Jumeirah 3",
        countryCode: "AE",
        latitude: 25.1972,
        longitude: 55.2744,
        addressCode: "AXD",
        contactPhone: "+971500000001",
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
    notes: "S-8 sandbox smoke — Day 4 round-trip evidence",
    shipFrom: {
      addressLine1: "Warehouse A",
      city: "Dubai",
      countryCode: "AE",
      latitude: 25.0,
      longitude: 55.0,
      contactPhone: "+971500000001",
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

  console.log(`[${new Date().toISOString()}] step=create_task start order_number=${orderNumber}`);
  const taskRes = await fetch(`${BASE}/api/tasks`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${auth.accessToken}`,
      Clientid: clientId,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!taskRes.ok) {
    console.error(`create_task failed: status=${taskRes.status}`);
    const txt = await taskRes.text();
    console.error(`response (first 500 chars): ${txt.slice(0, 500)}`);
    process.exit(3);
  }
  const task = await taskRes.json();
  console.log(
    `[${new Date().toISOString()}] step=create_task ok ` +
    `external_id=${task.id ?? task.taskId ?? "?"} ` +
    `awb=${task.awb ?? task.trackingNumber ?? "?"} ` +
    `status=${task.status ?? "?"}`,
  );
  console.log(`[${new Date().toISOString()}] response_keys=${Object.keys(task).join(",")}`);
}

main().catch((e) => {
  console.error("smoke failed:", e.message);
  process.exit(99);
});
