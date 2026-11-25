import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "../../lib/api/request";

type FoodCategories = { categories: string[]; previousCategories: string[] };
export type CategoryChange =
  | { action: "add"; newName: string }
  | { action: "rename"; name: string; newName: string }
  | { action: "remove"; name: string };

const endpoint = "/api/paideuo/v1/nutrition/food-categories";
export const foodCategoriesKey = (ownerId: string) =>
  ["nutrition", "food-categories", ownerId] as const;

export const useFoodCategories = (ownerId: string) =>
  useQuery({
    queryKey: foodCategoriesKey(ownerId),
    queryFn: ({ signal }) => apiRequest<FoodCategories>(endpoint, "GET", undefined, signal),
    retry: false,
  });

export const changeFoodCategory = (change: CategoryChange) =>
  apiRequest<FoodCategories>(endpoint, "PUT", change);
