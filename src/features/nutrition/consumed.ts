import { apiRequest } from "../../lib/api/request";
import type { EntryFields, FoodSource, FoodSnapshot, NutritionTotals } from "./planned";
import type { EffectiveTarget } from "./targets";

export type ConsumedDraft = {
  externalId: string;
  data: Omit<EntryFields, "order"> & {
    source: FoodSource | { kind: "planned" };
    consumedAt?: string;
    plannedId?: string;
    programId?: string;
    timezone?: string;
  };
};

export type ConsumedEntry = {
  id: string;
  externalId: string;
  data: Omit<ConsumedDraft["data"], "source"> & {
    source: Exclude<FoodSource, { kind: "inline" }> | { kind: "inline" | "planned" };
    snapshot: FoodSnapshot;
    timezone: string;
  };
};

export type ConsumedChange =
  | ({ action: "create" } & ConsumedDraft)
  | {
      action: "update";
      id: string;
      data: Omit<EntryFields, "order" | "meal"> & {
        meal: string | null;
        consumedAt?: string | null;
      };
    }
  | { action: "delete"; id: string }
  | { action: "batch_create"; entries: ConsumedDraft[] };

const send = <T>(path: string, input: object, signal?: AbortSignal) =>
  apiRequest<T>("/api/paideuo/v1/nutrition/" + path, "POST", input, signal);

export const consumedKey = (owner: string) => ["nutrition", "consumed", owner] as const;

export type NutritionDaySummary = {
  date: string;
  planned: NutritionTotals;
  consumed: NutritionTotals;
  target: EffectiveTarget;
  targetProgramId?: string;
};

export const consumedApi = {
  summary: (date: string, programId: string | undefined, signal: AbortSignal) =>
    send<NutritionDaySummary>("days/summary", { date, programId }, signal),
  summaryRange: (
    startDate: string,
    endDate: string,
    programId: string | undefined,
    signal: AbortSignal,
    autoTargets?: boolean,
  ) =>
    send<{ days: NutritionDaySummary[] }>(
      "days/summary_range",
      { startDate, endDate, programId, autoTargets },
      signal,
    ),
  list: async (filter: { date: string } | { plannedId: string }, signal: AbortSignal) => {
    const entries: ConsumedEntry[] = [];
    let after: string | null = null;
    do {
      const page: { items: ConsumedEntry[]; next: string | null } = await send(
        "consumed/list",
        { ...filter, limit: 100, after: after ?? undefined },
        signal,
      );
      entries.push(...page.items);
      after = page.next;
    } while (after);
    return entries;
  },
  mutate: ({ change, operationId }: { change: ConsumedChange; operationId: string }) => {
    const { action, ...input } = change;
    return send("consumed/" + action, { ...input, operationId });
  },
};
