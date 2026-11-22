export type ComponentTargets = {
  sets?: number;
  reps?: string;
  repetitions?: number;
  segments?: {
    type: "warmup" | "work" | "recovery" | "cooldown";
    duration_seconds: number;
    modality?: "running" | "walking";
  }[];
  load?: { value: number; unit: string };
  intensity?: { value?: number; min?: number; max?: number; scale: "RPE" };
  grade?: { min?: string; max?: string };
  angle_degrees?: number;
  work_seconds?: number;
  rest_seconds?: number;
};

export type PrescriptionComponent = {
  key?: string;
  name: string;
  instructions: string;
  durationMin: number | null;
  durationMax?: number | null;
  classification?: "aerobic" | "strength" | "movement" | "mobility" | "other";
  optional?: boolean;
  targets?: ComponentTargets | null;
};

type TargetName = keyof ComponentTargets | "duration";
type TargetDrafts = Partial<Record<TargetName, string[]>>;
export type ComponentDraft = {
  key: number;
  snapshotKey?: string;
  name: string;
  instructions: string;
  classification?: "aerobic" | "strength" | "movement" | "mobility" | "other";
  optional?: boolean;
  targets: TargetDrafts;
};

export const componentDraft = (
  key: number,
  {
    key: snapshotKey = crypto.randomUUID(),
    name,
    instructions,
    classification,
    optional,
    durationMin,
    durationMax,
    targets,
  }: PrescriptionComponent,
): ComponentDraft => ({
  key,
  snapshotKey,
  name,
  instructions,
  classification,
  optional,
  targets: {
    ...(durationMin != null || durationMax != null
      ? {
          duration: [
            durationMin != null ? String(durationMin) : "",
            durationMax != null ? String(durationMax) : "",
          ],
        }
      : {}),
    ...(targets?.sets != null ? { sets: [String(targets.sets)] } : {}),
    ...(targets?.reps != null ? { reps: [targets.reps] } : {}),
    ...(targets?.load ? { load: [String(targets.load.value), targets.load.unit] } : {}),
    ...(targets?.intensity
      ? {
          intensity: [
            String(targets.intensity.value ?? targets.intensity.min ?? ""),
            targets.intensity.max != null ? String(targets.intensity.max) : "",
          ],
        }
      : {}),
    ...(targets?.grade ? { grade: [targets.grade.min ?? "", targets.grade.max ?? ""] } : {}),
    ...(targets?.angle_degrees != null ? { angle_degrees: [String(targets.angle_degrees)] } : {}),
    ...(targets?.work_seconds != null ? { work_seconds: [String(targets.work_seconds)] } : {}),
    ...(targets?.rest_seconds != null ? { rest_seconds: [String(targets.rest_seconds)] } : {}),
    ...(targets?.repetitions != null ? { repetitions: [String(targets.repetitions)] } : {}),
    ...(targets?.segments ? { segments: [JSON.stringify(targets.segments)] } : {}),
  },
});

const parseSegments = (input: string): ComponentTargets["segments"] => {
  const message =
    'Enter a nonempty JSON array such as [{"type":"work","duration_seconds":60,"modality":"running"}]. Use whole seconds and omit modality or choose running or walking.';
  let value: unknown;
  try {
    value = JSON.parse(input);
  } catch {
    throw new Error(message);
  }
  if (
    !Array.isArray(value) ||
    !value.length ||
    !value.every(
      (segment) =>
        segment &&
        typeof segment === "object" &&
        !Array.isArray(segment) &&
        Object.keys(segment).every((key) =>
          ["type", "duration_seconds", "modality"].includes(key),
        ) &&
        ["warmup", "work", "recovery", "cooldown"].includes(segment.type) &&
        Number.isSafeInteger(segment.duration_seconds) &&
        segment.duration_seconds >= 0 &&
        (!Object.hasOwn(segment, "modality") || ["running", "walking"].includes(segment.modality)),
    )
  ) {
    throw new Error(message);
  }
  return value;
};

export const segmentError = (input: string) => {
  try {
    parseSegments(input);
    return "";
  } catch (error) {
    return (error as Error).message;
  }
};

export const targetRangeError = (key: TargetName, values: string[]) => {
  if (key !== "duration" && key !== "intensity") return "";
  const minText = values[0]?.trim();
  const maxText = values[1]?.trim();
  if (key === "intensity" && maxText && !minText) {
    return "Enter a minimum RPE or clear the maximum.";
  }
  if (!minText || !maxText) return "";
  const min = Number(minText);
  const max = Number(maxText);
  if (!Number.isFinite(min) || !Number.isFinite(max)) return "Enter valid numeric endpoints.";
  if (max < min) return "Maximum must be greater than or equal to minimum.";
  return "";
};

export const componentPayload = ({
  snapshotKey,
  name,
  instructions,
  classification,
  optional,
  targets,
}: ComponentDraft): PrescriptionComponent => {
  const {
    duration,
    sets,
    reps,
    load,
    intensity,
    grade,
    angle_degrees,
    work_seconds,
    rest_seconds,
    repetitions,
    segments,
  } = targets;
  const durationMin = duration?.[0] ? Number(duration[0]) : null;
  const durationMax = duration?.[1] ? Number(duration[1]) : null;
  const intensityMin = intensity?.[0] ? Number(intensity[0]) : null;
  const intensityMax = intensity?.[1] ? Number(intensity[1]) : null;
  const intensityError = intensity ? targetRangeError("intensity", intensity) : "";
  if (intensityError) throw new Error(intensityError);
  return {
    ...(snapshotKey ? { key: snapshotKey } : {}),
    name,
    instructions,
    ...(classification ? { classification } : {}),
    ...(optional ? { optional: true } : {}),
    durationMin,
    ...(durationMax != null ? { durationMax } : {}),
    targets: {
      ...(sets ? { sets: Number(sets[0]) } : {}),
      ...(reps ? { reps: reps[0].trim() } : {}),
      ...(load ? { load: { value: Number(load[0]), unit: load[1].trim() } } : {}),
      ...(intensityMin == null
        ? {}
        : {
            intensity:
              intensityMax == null
                ? { value: intensityMin, scale: "RPE" }
                : { min: intensityMin, max: intensityMax, scale: "RPE" },
          }),
      ...(grade
        ? { grade: { min: grade[0].trim() || undefined, max: grade[1].trim() || undefined } }
        : {}),
      ...(angle_degrees ? { angle_degrees: Number(angle_degrees[0]) } : {}),
      ...(work_seconds ? { work_seconds: Number(work_seconds[0]) } : {}),
      ...(rest_seconds ? { rest_seconds: Number(rest_seconds[0]) } : {}),
      ...(repetitions ? { repetitions: Number(repetitions[0]) } : {}),
      ...(segments ? { segments: parseSegments(segments[0]) } : {}),
    },
  };
};

type TargetField = {
  label: string;
  type?: "number";
  min?: number;
  max?: number;
  step?: number | "any";
  required?: false;
  maxLength?: number;
};

export const targetDefinitions: { key: TargetName; label: string; fields: TargetField[] }[] = [
  {
    key: "duration",
    label: "Duration",
    fields: [
      {
        label: "Minimum component duration in minutes",
        type: "number",
        min: 0,
        step: 1,
        required: false,
      },
      {
        label: "Maximum component duration in minutes",
        type: "number",
        min: 0,
        step: 1,
        required: false,
      },
    ],
  },
  { key: "sets", label: "Sets", fields: [{ label: "Sets", type: "number", min: 0, step: 1 }] },
  { key: "reps", label: "Repetitions", fields: [{ label: "Repetitions", maxLength: 200 }] },
  {
    key: "load",
    label: "Load",
    fields: [
      { label: "Load value", type: "number", min: 0, step: "any" },
      { label: "Load unit", maxLength: 32 },
    ],
  },
  {
    key: "intensity",
    label: "RPE",
    fields: [
      { label: "Minimum RPE", type: "number", min: 1, max: 10, step: "any", required: false },
      { label: "Maximum RPE", type: "number", min: 1, max: 10, step: "any", required: false },
    ],
  },
  {
    key: "grade",
    label: "Grade range",
    fields: [
      { label: "Minimum grade", required: false, maxLength: 64 },
      { label: "Maximum grade", required: false, maxLength: 64 },
    ],
  },
  {
    key: "angle_degrees",
    label: "Wall angle",
    fields: [{ label: "Wall angle in degrees", type: "number", min: 0, step: "any" }],
  },
  {
    key: "work_seconds",
    label: "Work interval",
    fields: [{ label: "Work interval in seconds", type: "number", min: 0, step: 1 }],
  },
  {
    key: "rest_seconds",
    label: "Rest interval",
    fields: [{ label: "Rest interval in seconds", type: "number", min: 0, step: 1 }],
  },
  {
    key: "repetitions",
    label: "Interval repetitions",
    fields: [{ label: "Repetitions", type: "number", min: 0, step: 1 }],
  },
  {
    key: "segments",
    label: "Ordered interval segments",
    fields: [
      {
        label: "Segments JSON (warmup/work/recovery/cooldown)",
        maxLength: 4000,
      },
    ],
  },
];
