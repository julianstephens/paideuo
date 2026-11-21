import type { ComponentObservation } from "../calendar/scheduling";
import { apiRequest } from "../../lib/api/request";
import type { MetricsPeriod, MetricsTotal } from "../compliance/metrics";

export type ReviewNotes = {
  worked: string;
  didNotWork: string;
  recoveryObservations: string;
  adjustments: string;
};

export type ReviewSummary = {
  weekId: string;
  blockId: string;
  label: string;
  blockLabel: string;
  window: MetricsPeriod["window"];
  updated: string | null;
};

export type WeeklyReview = ReviewSummary & {
  programName: string;
  editorAvailable: boolean;
  trainingAvailable: boolean;
  movementObservations: MovementObservation[];
  notes: ReviewNotes;
  total: MetricsTotal;
  days: MetricsPeriod[];
  progression: {
    jogging: {
      sessionId: string;
      date: string;
      title: string;
      status: "planned" | "completed" | "skipped";
      plannedBoutMin: number | null;
      actualBoutMin: number | null;
    }[];
    frontSquat: {
      sessionId: string;
      date: string;
      title: string;
      status: "planned" | "completed" | "skipped";
      plannedLoad: { value: number; unit: string } | null;
      plannedSets: number | null;
      plannedReps: string | null;
      plannedRpe: number | { min: number; max?: number; scale: "RPE" } | null;
      actualLoad: { value: number; unit: string } | null;
      actualSets: number | null;
      actualReps: string | null;
      actualRpe: number | null;
    }[];
    circuits: {
      sessionId: string;
      date: string;
      title: string;
      status: "planned" | "completed" | "skipped";
      plannedRounds: number | null;
      actualRounds: number | null;
    }[];
    aerobicByModality: Record<string, number>;
    plannedAerobicByModality: Record<string, number>;
    plannedAerobicMaxByModality: Record<string, number>;
    aerobicCoverage: { planned: number; measured: number; specified: number };
    sourceSessions: { id: string; date: string; title: string; status: string }[];
  };
  dataCoverage: {
    scheduledSessions: number;
    completedSessions: number;
    recoveryDays: number;
  };
};

export type MovementObservation = ComponentObservation & {
  sessionId: string;
  sessionDate: string;
  componentKey: string;
  componentName: string;
};

export const reviewKey = (ownerId: string, programId: string) =>
  ["weekly-reviews", ownerId, programId] as const;

const endpoint = (programId: string) =>
  `/api/paideuo/programs/${encodeURIComponent(programId)}/weekly-reviews`;
const detail = (programId: string, weekId: string) =>
  `${endpoint(programId)}/${encodeURIComponent(weekId)}`;

export const weeklyReviewUrl = (programId: string, weekId: string) =>
  `/programs/${encodeURIComponent(programId)}/weekly-reviews/${encodeURIComponent(weekId)}`;

export const reviewsApi = {
  list: (programId: string, signal: AbortSignal) =>
    apiRequest<ReviewSummary[]>(endpoint(programId), "GET", undefined, signal),
  get: (programId: string, weekId: string, signal: AbortSignal) =>
    apiRequest<WeeklyReview>(detail(programId, weekId), "GET", undefined, signal),
  save: (programId: string, weekId: string, notes: ReviewNotes) =>
    apiRequest<WeeklyReview>(detail(programId, weekId), "PUT", notes),
};
