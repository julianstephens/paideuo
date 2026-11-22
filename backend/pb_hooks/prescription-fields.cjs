const sessionFields = (workout) => ({
  title: workout.title,
  description: workout.description,
  session_type: workout.sessionType,
  notes: workout.notes ?? "",
  planned_duration_min: workout.plannedDurationMin ?? 0,
  duration_specified: workout.plannedDurationMin != null,
  planned_duration_max: workout.plannedDurationMax ?? 0,
  duration_max_specified: workout.plannedDurationMax != null,
  planned_rpe_min: workout.plannedRpeMin ?? 0,
  planned_rpe_max: workout.plannedRpeMax ?? 0,
  planned_intensity: workout.plannedIntensity ?? "",
});

const componentFields = (component, index) => ({
  position: index + 1,
  key: component.key,
  name: component.name,
  instructions: component.instructions,
  duration_min: component.durationMin ?? 0,
  duration_specified: component.durationMin != null,
  duration_max: component.durationMax ?? 0,
  duration_max_specified: component.durationMax != null,
  classification: component.classification ?? null,
  optional: component.optional === true,
  targets: component.targets ?? null,
});

const presentComponent = (component) => ({
  key: component.key,
  name: component.name,
  instructions: component.instructions,
  durationMin:
    component.duration_specified || component.duration_min > 0 ? component.duration_min : null,
  durationMax: component.duration_max_specified ? component.duration_max : null,
  classification: component.classification || null,
  optional: component.optional === true,
  targets: component.targets,
});

// oxlint-disable-next-line import/no-commonjs
module.exports = { sessionFields, componentFields, presentComponent };
