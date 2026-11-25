import { apiRequest } from "../../lib/api/request";

export type Ingredient = { name: string; quantity?: number; unit?: string; prep?: string };
export type RecipeFields = { ingredients: Ingredient[]; instructions?: string; portions?: number };
export type Recipe = { id: string; externalId: string; data: RecipeFields & { foodId: string } };
export type RecipeEntryKind = "planned" | "consumed";
type RecipePage = { items: Recipe[]; next: string | null };

type RecipeChange =
  | { action: "create"; foodId: string; data: RecipeFields }
  | { action: "update"; id: string; data: RecipeFields }
  | { action: "delete"; id: string };

export type RecipeMutation = {
  change: RecipeChange;
  operationId: string;
  externalId?: string;
};

const endpoint = "/api/paideuo/v1/nutrition/recipes/";
export const recipeQueryKey = (ownerId: string) => ["nutrition", "recipes", ownerId] as const;
export const foodRecipePath = (foodId: string) => "/nutrition/foods/" + foodId + "/recipe";

export const recipesApi = {
  forFood: async (foodId: string, signal: AbortSignal) => {
    const { items } = await apiRequest<RecipePage>(
      endpoint + "list",
      "POST",
      { foodId, limit: 1 },
      signal,
    );
    return items[0] ?? null;
  },
  forEntry: async (entryKind: RecipeEntryKind, entryId: string, signal: AbortSignal) => {
    const { recipe } = await apiRequest<{ recipe: Recipe | null }>(
      endpoint + "for_entry",
      "POST",
      { entryKind, entryId },
      signal,
    );
    return recipe;
  },
  mutate: ({ change, operationId, externalId }: RecipeMutation) => {
    const { action, ...input } = change;
    return apiRequest(endpoint + action, "POST", { ...input, operationId, externalId });
  },
};
