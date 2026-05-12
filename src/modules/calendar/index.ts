// Day-22n PR-C-A — Calendar module barrel.

export {
  computeWeekWindow,
  countTasksByDayAcrossConsignees,
  getCalendarFilterOptions,
  getCalendarMetrics,
} from "./service";

export type { CalendarFilterOptions } from "./service";

export { buildWeekDays } from "./repository";

export type {
  CalendarDayCount,
  CalendarFilters,
  CalendarMetrics,
  CalendarTopTaskForDay,
} from "./types";
