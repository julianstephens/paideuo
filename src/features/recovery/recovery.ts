import { apiRequest } from "../../lib/api/request";

export const recoveryMetrics = [
  { key: "sleepHours", label: "Sleep duration (hours)", min: 0, max: 24, step: "any", unit: "h" },
  { key: "sleepQuality", label: "Sleep quality (1–5)", min: 1, max: 5, step: 1, unit: "/ 5" },
  { key: "fatigue", label: "Fatigue (1–5)", min: 1, max: 5, step: 1, unit: "/ 5" },
  { key: "soreness", label: "Muscle soreness (1–5)", min: 1, max: 5, step: 1, unit: "/ 5" },
  {
    key: "readiness",
    label: "Self-reported readiness (1–5)",
    min: 1,
    max: 5,
    step: 1,
    unit: "/ 5",
  },
  {
    key: "restingHeartRate",
    label: "Resting heart rate (BPM)",
    min: 1,
    max: Number.MAX_SAFE_INTEGER,
    step: 1,
    unit: "BPM",
  },
] as const;

export const nutritionChoices = [
  {
    key: "nutritionAdequacy",
    label: "Nutrition adequacy",
    choices: [
      { value: "adequate", label: "Adequate" },
      { value: "likely_insufficient", label: "Likely insufficient" },
      { value: "unsure", label: "Unsure" },
    ],
  },
  {
    key: "trainingFueling",
    label: "Training fueling",
    choices: [
      { value: "adequate", label: "Adequate" },
      { value: "inadequate", label: "Inadequate" },
      { value: "not_applicable", label: "Not applicable" },
      { value: "unsure", label: "Unsure" },
    ],
  },
] as const;

export const protein = {
  key: "proteinGrams",
  label: "Protein intake (grams)",
  min: 0,
  step: "any",
  unit: "g",
} as const;

export const checkInSections = [
  {
    id: "recovery",
    label: "Recovery",
    title: "Pre-training check-in",
    fields: [...recoveryMetrics, { key: "notes", label: "Recovery notes" }],
  },
  {
    id: "nutrition",
    label: "Nutrition",
    title: "Nutrition log",
    fields: [...nutritionChoices, protein, { key: "nutritionNotes", label: "Nutrition notes" }],
  },
] as const;

export const checkInFieldKeys = checkInSections.flatMap(({ fields }) =>
  fields.map(({ key }) => key),
);

type NumericMetric = (typeof recoveryMetrics)[number]["key"] | typeof protein.key;
type ChoiceFields = {
  [Field in (typeof nutritionChoices)[number] as Field["key"]]:
    | Field["choices"][number]["value"]
    | null;
};
export type CheckInFields = Record<NumericMetric, number | null> &
  ChoiceFields & { notes: string; nutritionNotes: string };
export type CheckInEntry = CheckInFields & { date: string };
export type CheckInField = keyof CheckInFields;
export type CheckInSection = (typeof checkInSections)[number];

export const hasCheckInResponse = (entry: CheckInEntry | undefined, section: CheckInSection) =>
  !!entry &&
  section.fields.some(({ key }) => {
    const value = entry[key];
    return value != null && value !== "";
  });

const path = "/api/paideuo/check-ins";
const entryPath = (date: string) => `${path}/${encodeURIComponent(date)}`;
const preferencesPath = "/api/paideuo/check-in-preferences";
export type DurationUnit = "hours" | "minutes";
export type Preferences = {
  disabled: CheckInField[];
  hiddenCharts: string[];
  hiddenSummary: string[];
  durationUnit: DurationUnit;
};
type VisibilityUpdate = {
  group: "disabled" | "hiddenCharts" | "hiddenSummary";
  enabled: boolean;
} & ({ key: string } | { keys: readonly string[] });
export type PreferenceUpdate =
  | VisibilityUpdate
  | { group: "durationUnit"; durationUnit: DurationUnit };

export const checkInKey = (ownerId: string) => ["check-ins", ownerId] as const;
export const checkInPreferencesKey = (ownerId: string) =>
  ["check-in-preferences", ownerId] as const;

export const checkInApi = {
  list: (start: string, end: string, signal: AbortSignal) =>
    apiRequest<CheckInEntry[]>(
      `${path}?${new URLSearchParams({ start, end })}`,
      "GET",
      undefined,
      signal,
    ),
  save: (date: string, fields: Partial<Record<CheckInField, number | string | null>>) =>
    apiRequest<CheckInEntry>(entryPath(date), "PUT", fields),
  remove: (date: string) => apiRequest<void>(entryPath(date), "DELETE"),
  preferences: (signal: AbortSignal) =>
    apiRequest<Preferences>(preferencesPath, "GET", undefined, signal),
  updatePreferences: (change: PreferenceUpdate) =>
    apiRequest<Preferences>(preferencesPath, "PUT", change),
};

export const summarize = (entries: CheckInEntry[], key: NumericMetric) => {
  let mean = 0;
  let count = 0;
  for (const entry of entries) {
    const value = entry[key];
    if (value === null) continue;
    count++;
    mean += (value - mean) / count;
  }
  return { mean: count ? mean : null, count };
};
