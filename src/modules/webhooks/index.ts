// webhooks module — plan §3.3 / §6 webhook ingestion (R-6 QStash consumer).
//
// Day 9 / P4a: read-only configuration-page queries shipped first
// (URL builder + Tier-2 mismatch count + Tier-2-configured boolean).
// Receiver-side persistence + side-effect path land in subsequent
// commits.

export {
  buildWebhookUrl,
  countTier2MismatchesLast24h,
  resolvePublicBaseUrl,
  tier2CredentialsConfigured,
  type Tier2MismatchSummary,
} from "./queries";
