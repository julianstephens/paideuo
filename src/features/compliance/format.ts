const hourFormat = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 2,
  style: "unit",
  unit: "hour",
  unitDisplay: "short",
});
const percentFormat = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 1,
});

export const hours = (minutes: number | null) =>
  minutes === null ? "—" : hourFormat.format(minutes / 60);
export const percent = (ratio: number | null) =>
  ratio === null ? "—" : percentFormat.format(ratio);

const metricFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });

export const loadPoints = (load: number) => `${metricFormat.format(load)} load points`;
export const averageRpe = (rpe: number | null) => (rpe === null ? "—" : metricFormat.format(rpe));
