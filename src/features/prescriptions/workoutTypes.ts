import type { SessionType } from "../templates/templates";

export const workoutTypes = {
  climbing: { label: "Climbing", short: "Climb", palette: "purple" },
  strength: { label: "Strength", short: "Str", palette: "blue" },
  conditioning: { label: "Conditioning", short: "Cond", palette: "orange" },
  mobility: { label: "Mobility", short: "Mob", palette: "teal" },
  other: { label: "Other", short: "Other", palette: "pink" },
  rest: { label: "Rest", short: "Rest", palette: "gray" },
} satisfies Record<SessionType, { label: string; short: string; palette: string }>;
