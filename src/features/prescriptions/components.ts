export type ComponentTargets = {
  sets?: number;
  reps?: string;
  load?: { value: number; unit: string };
  intensity?: { value: number; scale: "RPE" };
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
  targets?: ComponentTargets | null;
};

type TargetName = keyof ComponentTargets | "duration";
type TargetDrafts = Partial<Record<TargetName, string[]>>;
export type ComponentDraft = {
  key: number;
  snapshotKey?: string;
  name: string;
  instructions: string;
  targets: TargetDrafts;
};

export const componentDraft = (
  key: number,
  {
    key: snapshotKey = crypto.randomUUID(),
    name,
    instructions,
    durationMin,
    targets,
  }: PrescriptionComponent,
): ComponentDraft => ({
  key,
  snapshotKey,
  name,
  instructions,
  targets: {
    ...(durationMin != null ? { duration: [String(durationMin)] } : {}),
    ...(targets?.sets != null ? { sets: [String(targets.sets)] } : {}),
    ...(targets?.reps != null ? { reps: [targets.reps] } : {}),
    ...(targets?.load ? { load: [String(targets.load.value), targets.load.unit] } : {}),
    ...(targets?.intensity ? { intensity: [String(targets.intensity.value)] } : {}),
    ...(targets?.grade ? { grade: [targets.grade.min ?? "", targets.grade.max ?? ""] } : {}),
    ...(targets?.angle_degrees != null ? { angle_degrees: [String(targets.angle_degrees)] } : {}),
    ...(targets?.work_seconds != null ? { work_seconds: [String(targets.work_seconds)] } : {}),
    ...(targets?.rest_seconds != null ? { rest_seconds: [String(targets.rest_seconds)] } : {}),
  },
});

export const componentPayload = ({
  snapshotKey,
  name,
  instructions,
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
  } = targets;
  return {
    ...(snapshotKey ? { key: snapshotKey } : {}),
    name,
    instructions,
    durationMin: duration ? Number(duration[0]) : null,
    targets: {
      ...(sets ? { sets: Number(sets[0]) } : {}),
      ...(reps ? { reps: reps[0].trim() } : {}),
      ...(load ? { load: { value: Number(load[0]), unit: load[1].trim() } } : {}),
      ...(intensity ? { intensity: { value: Number(intensity[0]), scale: "RPE" } } : {}),
      ...(grade
        ? { grade: { min: grade[0].trim() || undefined, max: grade[1].trim() || undefined } }
        : {}),
      ...(angle_degrees ? { angle_degrees: Number(angle_degrees[0]) } : {}),
      ...(work_seconds ? { work_seconds: Number(work_seconds[0]) } : {}),
      ...(rest_seconds ? { rest_seconds: Number(rest_seconds[0]) } : {}),
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
    fields: [{ label: "Component duration in minutes", type: "number", min: 0, step: 1 }],
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
    fields: [{ label: "RPE", type: "number", min: 1, max: 10, step: "any" }],
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
];
