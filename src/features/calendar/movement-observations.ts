import type { ComponentObservation } from "./scheduling";

export const observationCategory = (category: string) =>
  category === "knee_tracking" ? "Knee tracking" : category;

export const observationSeverities = ["none", "mild", "pronounced", "not_assessed"] as const;

export const observationSeverity = (category: string, severity: ComponentObservation["severity"]) =>
  ({
    none: category === "knee_tracking" ? "No collapse" : "None",
    mild: "Mild",
    pronounced: "Pronounced",
    not_assessed: "Not assessed",
  })[severity];
