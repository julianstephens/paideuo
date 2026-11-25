import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "../../lib/api/request";

type FoodCategories = { categories: string[]; previousCategories: string[] };
export type CategoryChange =
  | { action: "add"; newName: string }
  | { action: "rename"; name: string; newName: string }
  | { action: "remove"; name: string };

const endpoint = "/api/paideuo/v1/nutrition/categories/";
export const foodCategoriesKey = (ownerId: string) =>
  ["nutrition", "food-categories", ownerId] as const;

export const useFoodCategories = (ownerId: string) =>
  useQuery({
    queryKey: foodCategoriesKey(ownerId),
    queryFn: ({ signal }) => apiRequest<FoodCategories>(endpoint + "list", "POST", {}, signal),
    retry: false,
  });

export const changeFoodCategory = ({
  change,
  operationId,
}: {
  change: CategoryChange;
  operationId: string;
}) => {
  const { action, ...fields } = change;
  return apiRequest<FoodCategories>(endpoint + action, "POST", { ...fields, operationId });
};
