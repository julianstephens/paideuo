import { apiRequest } from "../../lib/api/request";
import { addDays, dateKey, monday, parseDate } from "../calendar/dates";

export type Span = { start: string; end: string };
export type TrainingWeek = Span & {
  id: string;
  position: number;
  label: string;
  recovery: boolean;
};
export type AnnualBlock = Span & {
  id: string;
  name: string;
  objective: string;
  durationWeeks: number;
  weeks: TrainingWeek[];
};
export type AnnualProgram = Span & { id: string; name: string; blocks: AnnualBlock[] };
type AnnualPlan = {
  programs: AnnualProgram[];
  workload: { start: string; minutes: number; missing: number }[];
};

export const getAnnualPlan = (year: number, hours: boolean, signal: AbortSignal) =>
  apiRequest<AnnualPlan>(
    "/api/paideuo/annual-plan?" +
      new URLSearchParams({ year: yearKey(year), hours: String(hours) }),
    "GET",
    undefined,
    signal,
  );

export const yearKey = (year: number) => String(year).padStart(4, "0");

export const yearTimeline = (year: number, quarter = 0) => {
  const first = yearKey(year) + "-01-01";
  const last = yearKey(year) + "-12-31";
  const start = new Date(first);
  const dayIndex = (date: string) => (Date.parse(date) - start.getTime()) / 86_400_000;

  const months = Array.from({ length: 12 }, (_, index) => {
    const date = new Date(start);
    date.setUTCMonth(index);
    const next = new Date(date);
    next.setUTCMonth(index + 1, 0);
    return { date, start: dateKey(date), end: dateKey(next) };
  });

  const weeks: Span[] = [];
  let cursor = start;
  while (dateKey(cursor) <= last) {
    // The first week may begin in December. Its visible span starts on January 1.
    const remaining = 6 - ((cursor.getUTCDay() + 6) % 7);
    const end = addDays(cursor, remaining);
    weeks.push({ start: dateKey(cursor), end: dateKey(end) > last ? last : dateKey(end) });
    if (dateKey(end) >= last) break;
    cursor = addDays(end, 1);
  }

  const visibleMonths = quarter ? months.slice((quarter - 1) * 3, quarter * 3) : months;
  const visibleStart = visibleMonths[0].start;
  const visibleEnd = visibleMonths[visibleMonths.length - 1].end;
  const offset = dayIndex(visibleStart);
  const columns = dayIndex(visibleEnd) - offset + 1;
  const visible = (span: Span) => span.start <= visibleEnd && span.end >= visibleStart;
  const place = (span: Span) =>
    `${Math.max(0, dayIndex(span.start) - offset) + 1} / ${Math.min(columns, dayIndex(span.end) - offset + 1) + 1}`;

  return { columns, place, visible, months: visibleMonths, weeks: weeks.filter(visible) };
};

export const calendarWeekPath = (date: string) =>
  "/?" + new URLSearchParams({ view: "week", date: dateKey(monday(parseDate(date)!)) });

// Programs arrive ordered by start date. A lane can be reused after its last program ends.
export const programLanes = (programs: AnnualProgram[]) => {
  const lanes: AnnualProgram[][] = [];
  for (const program of programs) {
    const lane = lanes.find((entries) => entries[entries.length - 1].end < program.start);
    if (lane) lane.push(program);
    else lanes.push([program]);
  }
  return lanes;
};
