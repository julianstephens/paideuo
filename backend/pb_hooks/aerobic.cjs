const add = (total, value) => (value == null ? total : (total ?? 0) + value);
const longest = (total, value) => (value == null ? total : Math.max(total ?? 0, value));

const plannedAerobic = ({ durationMin, durationMax, targets }) => {
  const { segments, repetitions = 1, work_seconds, rest_seconds = 0 } = targets ?? {};
  const intervals =
    segments ??
    (work_seconds == null
      ? []
      : [
          { type: "work", duration_seconds: work_seconds },
          { type: "recovery", duration_seconds: rest_seconds },
        ]);
  let minutes = null;
  let running = null;
  let walking = null;
  let bout = null;
  for (const segment of intervals) {
    const repeats = ["work", "recovery"].includes(segment.type) ? repetitions : 1;
    const segmentMinutes = segment.duration_seconds / 60;
    minutes = add(minutes, segmentMinutes * repeats);
    if (segment.modality === "running") running = add(running, segmentMinutes * repeats);
    if (segment.modality === "walking") walking = add(walking, segmentMinutes * repeats);
    if (repeats > 0 && segment.type === "work") bout = longest(bout, segmentMinutes);
  }
  return {
    minutes: durationMin ?? minutes,
    maxMinutes: durationMax ?? null,
    running,
    walking,
    bout,
  };
};

const measuredAerobic = (component, result) => {
  const running = result?.runningMin ?? null;
  const walking = result?.walkingMin ?? null;
  return {
    minutes: result?.durationMin ?? add(running, walking),
    running,
    walking,
    bout: result?.continuousBoutMin ?? null,
    modality: result?.aerobicModality ?? result?.modality ?? component.modality,
  };
};

// oxlint-disable-next-line import/no-commonjs
module.exports = { add, longest, plannedAerobic, measuredAerobic };
