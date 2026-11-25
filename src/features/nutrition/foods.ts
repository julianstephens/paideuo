import { apiRequest } from "../../lib/api/request";

export const macroFields = [
  { key: "calories", label: "Calories", unit: "kcal" },
  { key: "protein", label: "Protein", unit: "g" },
  { key: "carbohydrate", label: "Carbohydrate", unit: "g" },
  { key: "fat", label: "Fat", unit: "g" },
] as const;

export type FoodFields = {
  title: string;
  description?: string;
  category?: string;
  notes?: string;
  serving: { description: string; size: number; unit: string };
  macros: Partial<Record<(typeof macroFields)[number]["key"], number>>;
};
export type FoodPredictionInput = {
  title: string;
  category: string;
  servingDescription: string;
  servingSize: number;
  servingUnit: string;
  description?: string;
};
export type MacroEstimate = Required<FoodFields["macros"]>;

export type Food = { id: string; externalId: string; data: FoodFields & { archived?: boolean } };
export type FoodFilters = {
  search: string;
  category: string;
  status: "active" | "archived" | "all";
};
type FoodPage = { items: Food[]; next: string | null };

export type FoodChange =
  | { action: "create"; data: FoodFields }
  | { action: "update"; id: string; data: FoodFields }
  | { action: "duplicate"; id: string; title: string }
  | { action: "set_archive"; id: string; archived: boolean };

export type FoodMutation = { change: FoodChange; operationId: string; externalId?: string };

const endpoint = "/api/paideuo/v1/nutrition/foods/";
export const foodQueryKey = (owner: string) => ["nutrition", "foods", owner] as const;

export const foodsApi = {
  predictMacros: (input: FoodPredictionInput, signal: AbortSignal) =>
    apiRequest<{ macros: MacroEstimate }>(endpoint + "predict-macros", "POST", input, signal),
  get: (id: string, signal: AbortSignal) =>
    apiRequest<Food>(endpoint + "get", "POST", { id }, signal),
  list: (filters: FoodFilters, after: string | undefined, signal: AbortSignal) =>
    apiRequest<FoodPage>(endpoint + "list", "POST", { ...filters, after, limit: 25 }, signal),
  mutate: ({ change, operationId, externalId }: FoodMutation) => {
    const { action, ...input } = change;
    return apiRequest<Food>(endpoint + action, "POST", { ...input, operationId, externalId });
  },
};
