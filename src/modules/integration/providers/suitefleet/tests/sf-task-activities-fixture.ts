// =============================================================================
// SuiteFleet `GET /api/tasks/awb/{awb}/task-activities` response fixture
// =============================================================================
//
// >>> DOC-INFERRED SHAPE, NOT CAPTURE-DERIVED <<<
//
// Reconstructed from SuiteFleet API endpoint naming
// (suitefleet.readme.io getTimelineByAwb reading 4 May 2026), NOT
// from a documented schema OR a live response capture. The
// readme.io getTimelineByAwb page didn't expose a schema dump in
// what we fetched, so `{ task: { id, awb }, activities: [...] }`
// below is a reasonable structural guess from the endpoint's name
// — it is NOT attested by any SuiteFleet artefact. The third cron
// trigger (2 May 2026) hit a clean first-time push so no live
// timeline was captured pre-D8-4b.
//
// FIRST REAL PRODUCTION 23505/AWB-EXISTS VALIDATES OR INVALIDATES
// THIS SHAPE GUESS. If the production response diverges:
//
//   - Strict parser (`parseSuiteFleetTaskActivitiesResponse`)
//     throws `SuiteFleetTimelineParseError` rather than silently
//     mis-extracting. The cron's reconcile branch records a
//     `failed_pushes` row with failure_detail prefixed
//     `awb_exists_reconcile_failed: <awb>; getTaskByAwb error: <parse-msg>`.
//
//   - Operators see the parse-error message directly on
//     /admin/failed-pushes. Update this fixture (and the parser if
//     needed) and re-run the cron.
//
// Reviewer-locked posture (D8-4b): silent mis-extraction is the
// failure mode we explicitly avoid. Strict shape parser + typed
// error + visible failure_detail = vendor-shape divergence is
// observable, not absorbed.
//
// =============================================================================

/**
 * Doc-derived sample response. Inline a literal here rather than load
 * from JSON so:
 *   - the caveat header above is co-located with the data
 *   - the parser tests can import a typed constant (no JSON import + cast)
 *   - editing the fixture is one PR-visible TS file change rather than
 *     a JSON file that's easy to update without surfacing the change
 */
export const DOC_DERIVED_TASK_ACTIVITIES_RESPONSE = {
  task: {
    id: 59254,
    awb: "MPL-08187661",
  },
  activities: [
    {
      action: "TASK_HAS_BEEN_CREATED",
      occurredAt: "2026-05-02T15:57:56.000Z",
    },
  ],
} as const;

export const DOC_DERIVED_AWB = "MPL-08187661";
export const DOC_DERIVED_TASK_ID = 59254;
