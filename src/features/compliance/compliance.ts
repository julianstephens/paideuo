import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "../../lib/api/request";
import { programKeys } from "../programs/programs";
import type { PlannedIntensity } from "../programs/programs";

export type ComplianceTotals = {
  scheduled: number;
  completed: number;
  skipped: number;
  pending: number;
  unresolved: number;
  shortened: number;
  adherence: number | null;
  plannedMinutes: number | null;
  actualMinutes: number | null;
  resolvedPlannedMinutes: number;
  durationAttainment: number | null;
  measuredCompletions: number;
  specifiedDurations: number;
  intensity: Record<
    PlannedIntensity | "unspecified",
    { sessions: number; plannedMinutes: number | null }
  >;
};

type ComplianceWeek = {
  id: string;
  position: number;
  label: string;
  historical: boolean;
  total: ComplianceTotals;
};

type ComplianceBlock = {
  id: string;
  name: string;
  total: ComplianceTotals;
  weeks: ComplianceWeek[];
};
type ComplianceReport = {
  program: ComplianceTotals;
  blocks: ComplianceBlock[];
  unassigned: number;
};

export const useCompliance = (ownerId: string, programId: string, enabled = true) =>
  useQuery({
    queryKey: [...programKeys.detail(ownerId, programId), "compliance"],
    queryFn: ({ signal }) =>
      apiRequest<ComplianceReport>(
        `/api/paideuo/programs/${encodeURIComponent(programId)}/compliance`,
        "GET",
        undefined,
        signal,
      ),
    enabled,
    retry: false,
  });
