import { apiRequest } from "../../lib/api/request";
import type { FoodFields } from "./foods";
import type { EffectiveTarget, TargetLayer } from "./targets";

export type FoodSnapshot = Pick<FoodFields, "title" | "serving" | "macros">;
export type FoodSource = { kind: "bank"; foodId: string } | { kind: "inline"; food: FoodSnapshot };
export type EntryFields = {
  date: string;
  quantity: number;
  meal?: string;
  notes?: string;
  order?: number;
  overrides?: TargetLayer["macros"];
};

export type PlannedInput = EntryFields & {
  source: FoodSource;
  programId?: string;
  timezone?: string;
};
type PlannedData = Omit<PlannedInput, "source"> & {
  source: Exclude<FoodSource, { kind: "inline" }> | { kind: "inline" };
  snapshot: FoodSnapshot;
  canceled?: boolean;
};
export type PlannedEntry = { id: string; externalId: string; data: PlannedData };
export type DraftEntry = { externalId: string; data: PlannedInput };
export type NutritionTotals = {
  entryCount: number;
  macros: Record<keyof FoodFields["macros"], { subtotal: number | null; knownCount: number }>;
};
export type PlannedDay = {
  date: string;
  entries: PlannedEntry[];
  planned: NutritionTotals;
  target: EffectiveTarget;
  remaining: Required<NonNullable<TargetLayer["macros"]>>;
};
export type PlannedBatch =
  | { kind: "schedule"; entries: DraftEntry[] }
  | { kind: "copy"; id: string; destinationDate: string }
  | { kind: "clone"; startDate: string; endDate: string; destinationDate: string };

type Preview = {
  previewToken: string;
  additions: { externalId: string; data: PlannedData }[];
  destinations: { date: string; entries: PlannedEntry[] }[];
};

export type Change =
  | ({ action: "create" } & DraftEntry)
  | { action: "update"; id: string; data: Omit<EntryFields, "meal"> & { meal: string | null } }
  | { action: "delete"; id: string }
  | { action: "commit"; previewToken: string; batch: PlannedBatch };

const send = <T>(action: string, input: object, signal?: AbortSignal) =>
  apiRequest<T>("/api/paideuo/v1/nutrition/planned/" + action, "POST", input, signal);

export const plannedKey = (ownerId: string) => ["nutrition", "planner", ownerId] as const;

export const plannedApi = {
  list: async (date: string, signal: AbortSignal) => {
    const entries: PlannedEntry[] = [];
    let after: string | null = null;
    do {
      const page: { items: PlannedEntry[]; next: string | null } = await send(
        "list",
        { date, limit: 100, after: after ?? undefined },
        signal,
      );
      entries.push(...page.items);
      after = page.next;
    } while (after);
    return entries.sort((a, b) => (a.data.order ?? 0) - (b.data.order ?? 0));
  },
  week: (startDate: string, programId: string | undefined, signal: AbortSignal) =>
    send<{ days: PlannedDay[] }>("week", { startDate, programId }, signal),
  preview: (batch: PlannedBatch) => send<Preview>("preview", batch),
  mutate: ({ change, operationId }: { change: Change; operationId: string }) => {
    const { action, ...input } = change;
    return send(action, { ...input, operationId });
  },
};
