import type { SessionSnapshot } from "../calendar/scheduling";
import type { PrescriptionComponent } from "./components";
import { formatPlannedDuration, formatPlannedRpe } from "./format";

export type FieldChange = {
  label: string;
  before: string | null;
  after: string | null;
  multiline?: boolean;
};

const changedFields = (fields: FieldChange[]) =>
  fields.filter(({ before, after, multiline }) =>
    multiline
      ? before?.replaceAll("\r\n", "\n") !== after?.replaceAll("\r\n", "\n")
      : before !== after,
  );

const componentFields = (component: PrescriptionComponent) => {
  const { targets } = component;
  const { load, intensity, grade, segments } = targets ?? {};
  return {
    Name: component.name,
    Classification: component.classification ?? null,
    Requirement: component.optional ? "Optional" : "Required",
    Duration: formatPlannedDuration(component.durationMin, component.durationMax),
    Sets: targets?.sets?.toString() ?? null,
    Reps: targets?.reps ?? null,
    Repetitions: targets?.repetitions?.toString() ?? null,
    Load: load ? `${load.value} ${load.unit}` : null,
    RPE: formatPlannedRpe(intensity?.value ?? intensity?.min, intensity?.max),
    Grade: grade ? [grade.min, grade.max].filter(Boolean).join("–") : null,
    Angle: targets?.angle_degrees == null ? null : `${targets.angle_degrees}°`,
    "Work interval": targets?.work_seconds == null ? null : `${targets.work_seconds} s`,
    "Rest interval": targets?.rest_seconds == null ? null : `${targets.rest_seconds} s`,
    Segments:
      segments
        ?.map(({ type, duration_seconds, modality }) =>
          [type, `${duration_seconds} s`, modality].filter(Boolean).join(" · "),
        )
        .join("\n") ?? null,
    Instructions: component.instructions || null,
  };
};

const componentChanges = (first: PrescriptionComponent[], second: PrescriptionComponent[]) => {
  const before = first.map(componentFields);
  const after = second.map(componentFields);
  const beforeSignatures = before.map((fields) => JSON.stringify(fields));
  const afterSignatures = after.map((fields) => JSON.stringify(fields));
  const matches = new Map<number, number>();
  const taken = new Set<number>();

  // Shared keys identify edits within a prescription. Copies can have new keys.
  for (const equivalent of [
    (i: number, j: number) => !!first[i].key && first[i].key === second[j].key,
    (i: number, j: number) => beforeSignatures[i] === afterSignatures[j],
    (i: number, j: number) => first[i].name === second[j].name,
  ]) {
    first.forEach((_, i) => {
      if (matches.has(i)) return;
      const j = second.findIndex((_, index) => !taken.has(index) && equivalent(i, index));
      if (j === -1) return;
      matches.set(i, j);
      taken.add(j);
    });
  }

  const oldOrder = [...matches.keys()].sort((a, b) => a - b);
  const newOrder = [...oldOrder].sort((a, b) => matches.get(a)! - matches.get(b)!);
  const fieldsFor = (oldIndex?: number, newIndex?: number) => {
    const previous = oldIndex === undefined ? undefined : before[oldIndex];
    const next = newIndex === undefined ? undefined : after[newIndex];
    const labels = Object.keys(next ?? previous!) as (keyof ReturnType<typeof componentFields>)[];
    return changedFields(
      labels.map((label) => ({
        label,
        before: previous?.[label] ?? null,
        after: next?.[label] ?? null,
        multiline: label === "Instructions" || label === "Segments",
      })),
    );
  };

  return [
    ...first.flatMap((component, i) => {
      const j = matches.get(i);
      if (j === undefined)
        return [
          { id: `before-${i}`, name: component.name, status: "Removed", fields: fieldsFor(i) },
        ];
      const fields = fieldsFor(i, j);
      if (i !== j && oldOrder.indexOf(i) !== newOrder.indexOf(i)) {
        fields.unshift({ label: "Position", before: String(i + 1), after: String(j + 1) });
      }
      return fields.length
        ? [{ id: `before-${i}`, name: second[j].name, status: "Edited", fields }]
        : [];
    }),
    ...second.flatMap((component, j) =>
      taken.has(j)
        ? []
        : [
            {
              id: `after-${j}`,
              name: component.name,
              status: "Added",
              fields: fieldsFor(undefined, j),
            },
          ],
    ),
  ];
};

export const prescriptionChanges = (first: SessionSnapshot, second: SessionSnapshot) => ({
  fields: changedFields([
    { label: "Workout title", before: first.title, after: second.title },
    { label: "Workout type", before: first.sessionType, after: second.sessionType },
    {
      label: "Duration",
      before: formatPlannedDuration(first.plannedDurationMin, first.plannedDurationMax),
      after: formatPlannedDuration(second.plannedDurationMin, second.plannedDurationMax),
    },
    {
      label: "RPE",
      before: formatPlannedRpe(first.plannedRpeMin, first.plannedRpeMax),
      after: formatPlannedRpe(second.plannedRpeMin, second.plannedRpeMax),
    },
    { label: "Intensity", before: first.plannedIntensity, after: second.plannedIntensity },
    {
      label: "Description",
      before: first.description || null,
      after: second.description || null,
      multiline: true,
    },
    {
      label: "Programming notes",
      before: first.notes || null,
      after: second.notes || null,
      multiline: true,
    },
  ]),
  components: componentChanges(first.components, second.components),
});

type DiffLine = { kind: "Removed" | "Added" | "Context"; text: string };

export const textDiff = (before: string | null, after: string | null): DiffLine[] => {
  const oldLines = before?.split(/\r?\n/) ?? [];
  const newLines = after?.split(/\r?\n/) ?? [];
  if ((oldLines.length + 1) * (newLines.length + 1) > 40_000) {
    return [
      ...oldLines.map((text) => ({ kind: "Removed" as const, text })),
      ...newLines.map((text) => ({ kind: "Added" as const, text })),
    ];
  }

  const lengths = Array.from(
    { length: oldLines.length + 1 },
    () => new Uint32Array(newLines.length + 1),
  );
  for (let i = oldLines.length - 1; i >= 0; i--) {
    for (let j = newLines.length - 1; j >= 0; j--) {
      lengths[i][j] =
        oldLines[i] === newLines[j]
          ? 1 + lengths[i + 1][j + 1]
          : Math.max(lengths[i + 1][j], lengths[i][j + 1]);
    }
  }
  const lines: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < oldLines.length || j < newLines.length) {
    if (i < oldLines.length && j < newLines.length && oldLines[i] === newLines[j]) {
      lines.push({ kind: "Context", text: oldLines[i++] });
      j++;
    } else if (
      i < oldLines.length &&
      (j === newLines.length || lengths[i + 1][j] >= lengths[i][j + 1])
    ) {
      lines.push({ kind: "Removed", text: oldLines[i++] });
    } else {
      lines.push({ kind: "Added", text: newLines[j++] });
    }
  }
  const firstChange = lines.findIndex(({ kind }) => kind !== "Context");
  if (firstChange === -1) return [];
  let lastChange = lines.length - 1;
  while (lines[lastChange].kind === "Context") lastChange--;
  return lines
    .slice(firstChange, lastChange + 1)
    .filter(
      ({ kind }, index) => kind !== "Context" || lines[firstChange + index - 1]?.kind !== "Context",
    );
};
