// Day 19 / A2 plan §6.1 — POD column state helper.
//
// Pure function deriving the visual tone of the tasks-page POD cell
// from a task's pod_photos read shape. NULL or empty array → muted
// (greyed bag icon, no click affordance). Non-empty array → active
// (brand-color icon, click opens lightbox).
//
// Empty-array treatment matches reviewer ruling: `podPhotos = []`
// behaves identically to `podPhotos = null` for the surfacing layer.

export function podCellState(
  podPhotos: readonly string[] | null,
): "active" | "muted" {
  if (podPhotos === null) return "muted";
  if (podPhotos.length === 0) return "muted";
  return "active";
}
