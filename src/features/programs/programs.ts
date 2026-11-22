import type { ProgramSchedule } from "../calendar/scheduling";
import type { PrescriptionComponent } from "../prescriptions/components";
import type { SessionType } from "../templates/templates";
import { apiRequest } from "../../lib/api/request";
export { errorMessage } from "../../lib/api/request";

export const statuses = ["draft", "active", "completed", "archived"] as const;
export type ProgramStatus = (typeof statuses)[number];
export type ProgramFields = { name: string; description: string; objective: string };
export type ProgramSummary = ProgramFields & {
  id: string;
  status: ProgramStatus;
  blockCount: number;
  weekCount: number;
  scheduled: boolean;
};
export type BlockFields = { name: string; objective: string; durationWeeks: number };
export type Block = BlockFields & { id: string; position: number };
export type BlockSource = { id: string; name: string; programName: string };
export type SlotFields = { label: string; weekday: number };
export type Slot = SlotFields & { id: string; position: number; baselineName: string | null };
export const plannedIntensities = ["easy", "moderate", "hard", "maximal"] as const;
export type PlannedIntensity = (typeof plannedIntensities)[number];
export type WeekFields = { label: string; focus: string; weekType: "normal" | "recovery" };
export type ProgramWeek = WeekFields & { id: string; position: number };
export type PrescriptionFields = {
  title: string;
  sessionType: SessionType;
  description: string;
  notes: string;
  plannedDurationMin: number | null;
  plannedDurationMax?: number | null;
  plannedRpeMin?: number | null;
  plannedRpeMax?: number | null;
  plannedIntensity: PlannedIntensity | null;
};
export type PrescriptionSummary = Pick<
  PrescriptionFields,
  | "title"
  | "plannedDurationMin"
  | "plannedDurationMax"
  | "plannedRpeMin"
  | "plannedRpeMax"
  | "plannedIntensity"
> & {
  weekId: string;
  slotId: string;
  sessionType?: SessionType;
};
export type PrescriptionCell = {
  revision: string;
  prescription: (PrescriptionFields & { components: PrescriptionComponent[] }) | null;
};
export type DetailedPrescription = NonNullable<PrescriptionCell["prescription"]> &
  Pick<PrescriptionSummary, "weekId" | "slotId">;
export type CopyRequest = {
  destinationWeekId: string;
  slotId?: string;
  destinationSlotId?: string;
};
export type CopyPreview = { revision: string; copied: number; replaced: number; removed: number };
export type BlockDetail = Block & {
  scheduled: boolean;
  weeks: ProgramWeek[];
  slots: Slot[];
  prescriptions: PrescriptionSummary[];
};
export type StructuralImpact = {
  id: string;
  title: string;
  scheduledDate: string;
  revisedProgramDate: string | null;
  status: string;
  manuallyMoved: boolean;
};
export type RemovalPreview = {
  weekIds: string[];
  prescriptionIds: string[];
  scheduledSessions: StructuralImpact[];
};
export type Program = ProgramSummary & {
  blocks: Block[];
  schedule: ProgramSchedule | null;
  pendingScheduleChanges: boolean;
};

const endpoint = "/api/paideuo/programs";

const send = <T>(path: string, method?: string, body?: object, signal?: AbortSignal) =>
  apiRequest<T>(endpoint + path, method, body, signal);

const programPath = (id: string) => `/${encodeURIComponent(id)}`;

const blockPath = (programId: string, blockId: string) =>
  `${programPath(programId)}/blocks/${encodeURIComponent(blockId)}`;

export const blockEditorPath = (programId: string, blockId: string) =>
  `/programs${blockPath(programId, blockId)}`;

export const blocksApi = (programId: string, blockId: string) => {
  const path = blockPath(programId, blockId);
  const weekPath = (id: string) => `${path}/weeks/${encodeURIComponent(id)}`;
  const cellPath = (weekId: string, slotId: string) =>
    `${weekPath(weekId)}/cells/${encodeURIComponent(slotId)}`;
  const slotPath = (id: string) => `${path}/slots/${encodeURIComponent(id)}`;
  return {
    get: (signal: AbortSignal) => send<BlockDetail>(path, "GET", undefined, signal),
    update: (fields: Pick<BlockFields, "name" | "objective">) => send(path, "PATCH", fields),
    resizePreview: (durationWeeks: number) =>
      send<RemovalPreview>(`${path}/resize-preview`, "POST", { durationWeeks }),
    resize: (durationWeeks: number, confirmation?: RemovalPreview) =>
      send(`${path}/resize`, "POST", { durationWeeks, confirmation }),
    duplicate: (destinationProgramId: string) =>
      send<{ id: string; programId: string }>(`${path}/duplicate`, "POST", {
        destinationProgramId,
      }),
    updateWeek: (weekId: string, fields: WeekFields) => send(weekPath(weekId), "PATCH", fields),
    compareWeeks: (left: string, right: string, signal: AbortSignal) =>
      send<DetailedPrescription[]>(
        `${path}/compare-weeks?${new URLSearchParams({ left, right })}`,
        "GET",
        undefined,
        signal,
      ),
    getCell: (weekId: string, slotId: string, signal: AbortSignal) =>
      send<PrescriptionCell>(cellPath(weekId, slotId), "GET", undefined, signal),
    saveCell: (
      weekId: string,
      slotId: string,
      fields: PrescriptionFields & { components?: PrescriptionComponent[] },
      revision: string,
    ) => send(cellPath(weekId, slotId), "PATCH", { ...fields, revision }),
    deleteCell: (weekId: string, slotId: string, revision: string) =>
      send(cellPath(weekId, slotId), "DELETE", { revision }),
    saveCellAsTemplate: (weekId: string, slotId: string, name: string, revision: string) =>
      send<{ id: string }>(`${cellPath(weekId, slotId)}/template`, "POST", { name, revision }),
    copyPreview: (weekId: string, request: CopyRequest) =>
      send<CopyPreview>(`${weekPath(weekId)}/copy-preview`, "POST", request),
    copyWeek: (weekId: string, request: CopyRequest, revision: string) =>
      send<CopyPreview>(`${weekPath(weekId)}/copy`, "POST", { ...request, revision }),
    initializeWeeks: () => send<{ created: number }>(`${path}/initialize-weeks`, "POST"),
    setSlotBaseline: (id: string, templateId: string | null) =>
      send(`${slotPath(id)}/baseline`, "PATCH", { templateId }),
    addSlot: (fields: SlotFields) => send(`${path}/slots`, "POST", fields),
    updateSlot: (id: string, fields: SlotFields) => send(slotPath(id), "PATCH", fields),
    moveSlot: (id: string, offset: -1 | 1) => send(`${slotPath(id)}/move`, "POST", { offset }),
    removeSlotPreview: (id: string) =>
      send<RemovalPreview>(`${slotPath(id)}/remove-preview`, "POST"),
    removeSlot: (id: string, confirmation: RemovalPreview) =>
      send(`${slotPath(id)}/remove`, "POST", { confirmation }),
  };
};

export const programsApi = {
  list: (signal: AbortSignal) => send<ProgramSummary[]>("", "GET", undefined, signal),
  get: (id: string, signal: AbortSignal) =>
    send<Program>(programPath(id), "GET", undefined, signal),
  create: (fields: ProgramFields) => send<{ id: string }>("", "POST", fields),
  remove: (id: string) => send<{ id: string }>(programPath(id), "DELETE"),
  update: (id: string, fields: ProgramFields) =>
    send<{ id: string }>(programPath(id), "PATCH", fields),
  complete: (id: string) => send<{ id: string }>(`${programPath(id)}/complete`, "POST"),
  archive: (id: string, unscheduleWorkouts = false) =>
    send<{ id: string }>(`${programPath(id)}/archive`, "POST", { unscheduleWorkouts }),
  unschedule: (id: string) => send<{ id: string }>(`${programPath(id)}/unschedule`, "POST"),
  duplicate: (id: string, operationId: string) =>
    send<{ id: string }>(`${programPath(id)}/duplicate`, "POST", { operationId }),
  blockSources: (signal: AbortSignal) =>
    send<BlockSource[]>("/block-sources", "GET", undefined, signal),
  addBlock: (id: string, fields: BlockFields & { sourceBlockId?: string }) =>
    send<{ id: string }>(`${programPath(id)}/blocks`, "POST", fields),
  reorder: (id: string, blockIds: string[]) =>
    send<{ id: string }>(`${programPath(id)}/reorder`, "POST", { blockIds }),
};

export const programKeys = {
  owner: (ownerId: string) => ["programs", ownerId] as const,
  list: (ownerId: string) => ["programs", ownerId, "list"] as const,
  blockSources: (ownerId: string) => ["programs", ownerId, "block-sources"] as const,
  block: (ownerId: string, programId: string, blockId: string) =>
    ["programs", ownerId, "detail", programId, "blocks", blockId] as const,
  detail: (ownerId: string, id: string) => ["programs", ownerId, "detail", id] as const,
};
