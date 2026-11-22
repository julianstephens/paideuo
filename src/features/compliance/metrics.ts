import type { ComplianceTotals } from "./compliance";

export const nutritionMetricLabels = {
  calories: "Calories consumed",
  proteinGrams: "Protein intake",
  mealTiming: "Meal timing",
  skippedMeals: "Skipped meals",
  morningWeightKg: "Morning body weight",
  hunger: "Hunger",
  digestion: "Digestion",
  energy: "Energy",
  trainingRecovery: "Training recovery",
} as const;

type NutritionMetric = keyof typeof nutritionMetricLabels;
export const nutritionMetricKeys = Object.keys(nutritionMetricLabels) as NutritionMetric[];
export const isNutritionMeasurement = (metric: Metric): metric is NutritionMetric =>
  Object.hasOwn(nutritionMetricLabels, metric);

export const metricLabels = {
  duration: "Planned and actual duration",
  load: "Session load",
  completion: "Session completion and adherence",
  sleep: "Sleep duration",
  fatigue: "Fatigue",
  soreness: "Muscle soreness",
  nutrition: "Nutrition adequacy",
  intensity: "Planned intensity",
  ...nutritionMetricLabels,
} as const;

export type Metric = keyof typeof metricLabels;
export const metricKeys = Object.keys(metricLabels) as Metric[];
export const isCheckInMetric = (metric: Metric) =>
  isNutritionMeasurement(metric) || ["sleep", "fatigue", "soreness", "nutrition"].includes(metric);
export const metricsKey = (ownerId: string) => ["metrics", ownerId] as const;

type Window = { start: string; end: string };
type RecoveryValue = { mean: number | null; count: number };
export type MetricsTotal = {
  compliance: ComplianceTotals;
  load: number | null;
  measuredLoad: number;
  averageRpe: number | null;
  measuredRpe: number;
  recovery: Record<"sleepHours" | "fatigue" | "soreness", RecoveryValue>;
  nutritionMeasurements: Record<NutritionMetric, { value: number | null; count: number }>;
  nutrition: Record<"adequate" | "likely_insufficient" | "unsure", number>;
};
export type MetricsPeriod = MetricsTotal & { id: string; label: string; window: Window | null };
export type MetricsReport = {
  window: Window | null;
  blockId: string | null;
  blocks: { id: string; label: string }[];
  unassigned: number;
  total: MetricsTotal;
  periods: MetricsPeriod[];
  days: MetricsPeriod[];
};

export type ComparedBlock = MetricsPeriod & {
  durationWeeks: number | null;
  weeks: (MetricsPeriod & { position: number })[];
};
