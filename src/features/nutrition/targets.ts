import { apiRequest } from "../../lib/api/request";

export const macroLabels = {
  calories: "Calories (kcal)",
  protein: "Protein (g)",
  carbohydrate: "Carbohydrate (g)",
  fat: "Fat (g)",
};
export const targetMacros = Object.keys(macroLabels) as (keyof typeof macroLabels)[];

export type TargetLayer = {
  active?: boolean;
  macros?: Partial<Record<keyof typeof macroLabels, number | null>>;
};
export type TargetSelector =
  | { kind: "block"; blockId: string }
  | { kind: "week"; weekId: string }
  | { kind: "weekday"; weekId: string; weekday: number }
  | { kind: "date"; date: string };

type RecordOf<T> = { id: string; externalId: string; data: T };
export type NutritionPlan = RecordOf<TargetLayer & { programId: string }>;
export type TargetOverride = RecordOf<TargetLayer & { planId: string; selector: TargetSelector }>;
type Source = { kind: "program" | TargetSelector["kind"]; id: string };
export type EffectiveTarget = {
  active: boolean;
  activationSource: Source | null;
  macros: Record<keyof typeof macroLabels, { value: number | null; source: Source | null }> | null;
};
type Change =
  | { kind: "plans"; action: "create"; programId: string; data: TargetLayer }
  | {
      kind: "targets";
      action: "create";
      planId: string;
      data: TargetLayer & { selector: TargetSelector };
    }
  | { kind: "plans" | "targets"; action: "update"; id: string; data: TargetLayer }
  | { kind: "plans" | "targets"; action: "delete"; id: string };
type Page<T> = { items: T[]; next: string | null };

const send = <T>(path: string, input: object, signal?: AbortSignal) =>
  apiRequest<T>("/api/paideuo/v1/nutrition/" + path, "POST", input, signal);

export const targetKey = (ownerId: string, programId: string) =>
  ["nutrition-targets", ownerId, programId] as const;

export const targetsApi = {
  plan: async (programId: string, signal: AbortSignal) => {
    const { items } = await send<Page<NutritionPlan>>(
      "plans/list",
      { programId, limit: 1 },
      signal,
    );
    return items[0] ?? null;
  },
  overrides: async (planId: string, signal: AbortSignal) => {
    const overrides: TargetOverride[] = [];
    let after: string | undefined;
    do {
      const page: Page<TargetOverride> = await send("targets/list", { planId, after }, signal);
      overrides.push(...page.items);
      after = page.next ?? undefined;
    } while (after);
    return overrides;
  },
  resolve: (programId: string, date: string, signal: AbortSignal) =>
    send<EffectiveTarget>("targets/resolve", { programId, date }, signal),
  bulk: (programId: string, startDate: string, endDate: string, signal: AbortSignal) =>
    send<{ days: { date: string; target: EffectiveTarget }[] }>(
      "targets/resolve_bulk",
      { programId, startDate, endDate },
      signal,
    ),
  mutate: ({ kind, action, ...input }: Change, operationId: string, externalId: string) =>
    send<{ id: string }>(kind + "/" + action, {
      ...input,
      operationId,
      externalId: action === "create" ? externalId : undefined,
    }),
};
