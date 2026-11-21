const formatBounds = (min: number | null | undefined, max: number | null | undefined) => {
  if (min == null) return max == null ? null : `≤${max}`;
  return max == null ? String(min) : `${min}–${max}`;
};

export const formatPlannedDuration = (min: number | null, max?: number | null) => {
  const bounds = formatBounds(min, max);
  return bounds === null ? null : `${bounds} min`;
};

export const formatPlannedRpe = (min?: number | null, max?: number | null) => {
  const bounds = formatBounds(min, max);
  return bounds === null ? null : `${bounds} RPE`;
};
