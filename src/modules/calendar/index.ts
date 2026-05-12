// Day-22n PR-C-A + Day-23n polish — Calendar module barrel.

export {
  computeWeekWindow,
  countTasksByDayAcrossConsignees,
  getCalendarFilterOptions,
  getCalendarMetrics,
  getCalendarMetricsTranscorpAdmin,
} from "./service";

export type { CalendarFilterOptions } from "./service";

export { buildWeekDays } from "./repository";

export type {
  CalendarDayCount,
  CalendarFilters,
  CalendarMetrics,
  CalendarMetricsTranscorpAdmin,
} from "./types";
