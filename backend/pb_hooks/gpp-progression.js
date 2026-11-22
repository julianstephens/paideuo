const { add, plannedAerobic, measuredAerobic } = require(__hooks + "/aerobic.cjs");

const { isRest, isOptional } = require(__hooks + "/training-prescription.cjs");

const normalized = (value) =>
  String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const valueOrNull = (value) => (value == null ? null : value);

const activityPatterns = [
  [/\b(?:run(?:ning)?|jog(?:ging)?) walk(?:ing)?\b/, "run/walk"],
  [/\b(?:run|running|jog|jogging)\b/, "running"],
  [/\b(?:walk|walking)\b/, "walking"],
  [/\b(?:bike|biking|cycle|cycling|bicycle)\b/, "cycling"],
  [/\b(?:row|rowing|rower)\b/, "rowing"],
  [/\b(?:swim|swimming)\b/, "swimming"],
];

const modalityFor = (label, fallback = "unspecified") => {
  const name = normalized(label);
  return activityPatterns.find(([pattern]) => pattern.test(name))?.[1] ?? (name || fallback);
};

const prescribedModality = (component, name) =>
  component.modality
    ? modalityFor(component.modality)
    : (activityPatterns.find(([pattern]) => pattern.test(name))?.[1] ?? "unspecified");

const addByModality = (totals, minutes, { running, walking }, modality) => {
  if (running == null && walking == null) {
    if (minutes != null) totals[modality] = add(totals[modality], minutes);
    return;
  }

  if (running != null) totals.running = add(totals.running, running);
  if (walking != null) totals.walking = add(totals.walking, walking);
  const unallocated = (minutes ?? 0) - (running ?? 0) - (walking ?? 0);
  if (unallocated > 0) totals.unspecified = add(totals.unspecified, unallocated);
};

const formatLoad = (load) => (load ? { value: load.value, unit: load.unit } : null);

const progression = (sessions) => {
  const jogging = [];
  const frontSquat = [];
  const circuits = [];
  const aerobicByModality = Object.create(null);
  const plannedAerobicByModality = Object.create(null);
  const plannedAerobicMaxByModality = Object.create(null);
  let aerobicMeasured = 0;
  let aerobicSpecified = 0;
  let aerobicPlanned = 0;
  const sourceSessions = [];

  for (const session of sessions) {
    if (isRest(session)) continue;
    const status = session.status;
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
      if (isOptional(component)) continue;
      const name = normalized(component.name);
      const target = component.targets ?? {};
      const result = status === "completed" ? results.get(component.key) : null;
      const isAerobic = component.classification === "aerobic";
      const isJogging = name.includes("jog") || name.includes("running");
      const planned = isAerobic || isJogging ? plannedAerobic(component) : null;

      if (isJogging || planned?.running != null) {
        jogging.push({
          sessionId: session.id,
          date: session.scheduledDate,
          title: component.name,
          status,
          plannedBoutMin: planned.bout,
          actualBoutMin: valueOrNull(result?.continuousBoutMin),
        });
      }

      if (name.includes("front squat")) {
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

      if (!isAerobic) continue;
      aerobicPlanned++;
      const modality = prescribedModality(component, name);
      addByModality(plannedAerobicByModality, planned.minutes, planned, modality);
      addByModality(
        plannedAerobicMaxByModality,
        planned.maxMinutes ?? planned.minutes,
        planned,
        modality,
      );
      if (status !== "completed") continue;

      aerobicSpecified++;
      const actual = measuredAerobic(component, result);
      if (actual.minutes == null) continue;
      aerobicMeasured++;
      addByModality(
        aerobicByModality,
        actual.minutes,
        actual,
        modalityFor(actual.modality, modality),
      );
    }
  }

  return {
    jogging,
    frontSquat,
    circuits,
    aerobicByModality: { ...aerobicByModality },
    plannedAerobicByModality: { ...plannedAerobicByModality },
    plannedAerobicMaxByModality: { ...plannedAerobicMaxByModality },
    aerobicCoverage: {
      planned: aerobicPlanned,
      measured: aerobicMeasured,
      specified: aerobicSpecified,
    },
    sourceSessions,
  };
};

// oxlint-disable-next-line import/no-commonjs
module.exports = { progression };
