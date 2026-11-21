import type { ComplianceTotals } from "../compliance/compliance";
import { apiRequest } from "../../lib/api/request";
import type { PrescriptionComponent } from "../prescriptions/components";
import type { PrescriptionFields } from "../programs/programs";

export type ScheduleRequest = { startDate: string; timezone: string };
export type ProgramSchedule = ScheduleRequest & { id: string; status: "active" | "completed" };
export type SessionSnapshot = PrescriptionFields & { components: PrescriptionComponent[] };
type DatedPrescription = { scheduledDate: string; prescription: SessionSnapshot };
type RevisionSession = DatedPrescription & { slotPosition: number };
export type ScheduleChange = {
  id: string;
  kind: "add" | "update" | "remove" | "keep-moved";
  before: RevisionSession | null;
  after: RevisionSession | null;
  programDate?: string;
  manuallyMoved?: boolean;
  blockedReason: string | null;
};
export type RevisionPreview = { revision: string; changes: ScheduleChange[] };
export type ApplyRevisions = { revision: string; changeIds: string[]; operationId: string };
export type SchedulePreview = {
  revision: string;
  sessions: (DatedPrescription & { sourcePrescriptionId: string; slotPosition: number })[];
};
export type SessionCompletion = {
  completedDate: string;
  actualDurationMin: number | null;
  sessionRpe: number | null;
  notes: string;
};
export type ComponentResult = {
  componentKey: string;
  load: { value: number; unit: string } | null;
  sets: number | null;
  reps: string | null;
  rpe: number | null;
  durationMin: number | null;
  rounds: number | null;
  notes: string;
};
export type SessionExecution =
  | {
      action: "complete" | "edit-completion";
      completion: SessionCompletion;
      componentResults: ComponentResult[];
    }
  | { action: "skip" | "restore" };
export type SessionExecutionState = {
  revision: string;
  status: "planned" | "completed" | "skipped";
  completion: SessionCompletion | null;
  componentResults: ComponentResult[];
  sessionLoad: number | null;
};
export type CalendarSession = DatedPrescription &
  SessionExecutionState & {
    id: string;
    programId: string | null;
    programName: string | null;
    originalDate: string;
    timezone: string;
    manuallyMoved: boolean;
  };

export type CalendarReport = { sessions: CalendarSession[]; summary: ComplianceTotals };

const schedulePath = (programId: string) =>
  `/api/paideuo/programs/${encodeURIComponent(programId)}/schedule`;

const sessionPath = (sessionId: string) =>
  "/api/paideuo/calendar/sessions/" + encodeURIComponent(sessionId);

export const schedulingApi = {
  createOneOff: (fields: DatedPrescription & { timezone: string; operationId: string }) =>
    apiRequest<{ id: string }>("/api/paideuo/calendar/sessions", "POST", fields),
  preview: (programId: string, fields: ScheduleRequest) =>
    apiRequest<SchedulePreview>(schedulePath(programId) + "/preview", "POST", fields),
  confirm: (programId: string, fields: ScheduleRequest, revision: string) =>
    apiRequest<ProgramSchedule>(schedulePath(programId), "POST", { ...fields, revision }),
  previewRevisions: (programId: string, signal: AbortSignal) =>
    apiRequest<RevisionPreview>(
      schedulePath(programId) + "/revisions/preview",
      "POST",
      undefined,
      signal,
    ),
  applyRevisions: (programId: string, selection: ApplyRevisions) =>
    apiRequest<{ applied: number }>(
      schedulePath(programId) + "/revisions/apply",
      "POST",
      selection,
    ),
  reschedule: (session: CalendarSession, scheduledDate: string) =>
    apiRequest<{ id: string; scheduledDate: string }>(sessionPath(session.id), "PATCH", {
      revision: session.revision,
      scheduledDate,
    }),
  edit: (session: CalendarSession, prescription: SessionSnapshot) =>
    apiRequest<{ id: string }>(sessionPath(session.id) + "/prescription", "PATCH", {
      revision: session.revision,
      prescription,
    }),
  deleteSession: (session: CalendarSession) =>
    apiRequest<{ id: string }>(sessionPath(session.id), "DELETE", { revision: session.revision }),
  execute: (sessionId: string, revision: string, execution: SessionExecution) =>
    apiRequest<SessionExecutionState>(sessionPath(sessionId) + "/execution", "PATCH", {
      ...execution,
      revision,
    }),
  calendar: (start: string, end: string, signal: AbortSignal) =>
    apiRequest<CalendarReport>(
      "/api/paideuo/calendar?" + new URLSearchParams({ start, end, summary: "true" }),
      "GET",
      undefined,
      signal,
    ),
};

export const calendarKey = (ownerId: string) => ["calendar", ownerId] as const;
