export const dateKey = (date: Date) => date.toISOString().split("T")[0];
const clampDate = (date: Date) =>
  date.getUTCFullYear() < 1
    ? new Date("0001-01-01T00:00:00Z")
    : date.getUTCFullYear() > 9999
      ? new Date("9999-12-31T00:00:00Z")
      : date;

export const parseDate = (value: string | null) => {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000")) return null;
  const date = new Date(value + "T00:00:00Z");
  return Number.isFinite(date.getTime()) && dateKey(date) === value ? date : null;
};

export const localToday = () => {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
};

export const addDays = (date: Date, days: number) => {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return clampDate(result);
};

export const monday = (date: Date) => addDays(date, -((date.getUTCDay() + 6) % 7));

export const monthStart = (date: Date, offset = 0) => {
  const result = new Date(date);
  result.setUTCMonth(result.getUTCMonth() + offset, 1);
  return clampDate(result);
};

export const formatDate = (date: Date, options: Intl.DateTimeFormatOptions) =>
  date.toLocaleDateString(undefined, { ...options, timeZone: "UTC" });

export const fullDate = (value: string) =>
  formatDate(new Date(value + "T00:00:00Z"), { dateStyle: "full" });

export const todayInTimezone = (timezone: string) => {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts();
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
};
