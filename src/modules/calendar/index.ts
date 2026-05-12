// Day-22n PR-C-A + Day-23n polish — Calendar module barrel.

export {
  computeMonthGridWindow,
  computeWeekWindow,
  countTasksByDayAcrossConsignees,
  countTasksByDayForMonth,
  getCalendarFilterOptions,
  getCalendarMetrics,
  getCalendarMetricsTranscorpAdmin,
  listTasksForDay,
} from "./service";

export type { CalendarFilterOptions } from "./service";

export { buildWeekDays } from "./repository";

export type {
  CalendarDayCount,
  CalendarDayTaskRow,
  CalendarFilters,
  CalendarMetrics,
  CalendarMetricsTranscorpAdmin,
} from "./types";
