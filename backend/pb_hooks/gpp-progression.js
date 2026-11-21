const normalized = (value) =>
  String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const valueOrNull = (value) => (value == null ? null : value);

const plannedBout = (targets) => {
  if (!targets) return null;
  if (targets.work_seconds != null) return targets.work_seconds / 60;
  if (!Array.isArray(targets.segments)) return null;
  const work = targets.segments
    .filter((segment) => segment.type === "work")
    .map((segment) => segment.duration_seconds / 60);
  return work.length ? Math.max(...work) : null;
};

const formatLoad = (load) => (load ? { value: load.value, unit: load.unit } : null);

const progression = (sessions) => {
  const jogging = [];
  const frontSquat = [];
  const circuits = [];
  const aerobicByModality = Object.create(null);
  const plannedAerobicByModality = Object.create(null);
  let aerobicMeasured = 0;
  let aerobicSpecified = 0;
  const sourceSessions = [];

  for (const session of sessions) {
    const status = session.status;
    const completion = session.completion;
    const prescription = session.prescription ?? {};
    const results = new Map(
      (session.componentResults ?? []).map((result) => [result.componentKey, result]),
    );
    sourceSessions.push({
      id: session.id,
      date: session.scheduledDate,
      title: prescription.title || "Scheduled workout",
      status,
    });

    for (const component of prescription.components ?? []) {
      const name = normalized(component.name);
      const target = component.targets ?? {};
      const result = results.get(component.key);

      if (name.includes("jog") || name.includes("running")) {
        const plannedBoutMin = plannedBout(target);
        jogging.push({
          sessionId: session.id,
          date: session.scheduledDate,
          title: component.name,
          status,
          plannedBoutMin: valueOrNull(plannedBoutMin),
          actualBoutMin: valueOrNull(result?.continuousBoutMin),
        });
      }

      if (name.includes("front squat") || name.includes("front-squat")) {
        frontSquat.push({
          sessionId: session.id,
          date: session.scheduledDate,
          title: component.name,
          status,
          plannedLoad: formatLoad(target.load),
          plannedSets: valueOrNull(target.sets),
          plannedReps: valueOrNull(target.reps),
          plannedRpe:
            target.intensity?.value ?? (target.intensity?.min != null ? target.intensity : null),
          actualLoad: formatLoad(result?.load),
          actualSets: valueOrNull(result?.sets),
          actualReps: valueOrNull(result?.reps),
          actualRpe: valueOrNull(result?.rpe),
        });
      }

      if (name.includes("circuit") || name.includes("round")) {
        circuits.push({
          sessionId: session.id,
          date: session.scheduledDate,
          title: component.name,
          status,
          plannedRounds: valueOrNull(target.repetitions),
          actualRounds: valueOrNull(result?.rounds),
        });
      }

      if (component.classification === "aerobic") {
        aerobicSpecified++;
        const modality =
          component.modality ??
          (Array.isArray(target.segments)
            ? [...new Set(target.segments.map((segment) => segment.modality).filter(Boolean))].join(
                "/",
              )
            : "unspecified");
        const plannedMinutes = target.segments
          ? target.segments.reduce((sum, segment) => sum + segment.duration_seconds / 60, 0) *
            (target.repetitions ?? 1)
          : target.durationMin;
        if (plannedMinutes != null) {
          const key = String(modality).toLowerCase().trim() || "unspecified";
          plannedAerobicByModality[key] = (plannedAerobicByModality[key] ?? 0) + plannedMinutes;
        }
        if (status !== "completed") continue;
        const actualMinutes =
          result?.durationMin ??
          (result?.runningMin == null && result?.walkingMin == null
            ? null
            : (result.runningMin ?? 0) + (result.walkingMin ?? 0));
        if (actualMinutes != null) {
          aerobicMeasured++;
          const modality = (
            result?.aerobicModality ??
            result?.modality ??
            component.modality ??
            "unspecified"
          )
            .toLowerCase()
            .trim();
          aerobicByModality[modality] = (aerobicByModality[modality] ?? 0) + actualMinutes;
        }
      }
    }
  }

  return {
    jogging,
    frontSquat,
    circuits,
    aerobicByModality: { ...aerobicByModality },
    plannedAerobicByModality: { ...plannedAerobicByModality },
    aerobicCoverage: { measured: aerobicMeasured, specified: aerobicSpecified },
    sourceSessions,
  };
};

// oxlint-disable-next-line import/no-commonjs
module.exports = { progression };
