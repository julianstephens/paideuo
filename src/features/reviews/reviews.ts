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
};

export type MovementObservation = {
  sessionDate: string;
  componentKey: string;
  componentName: string;
  category: string;
  severity: "none" | "mild" | "pronounced" | "not_assessed";
  context: string;
  notes: string;
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
