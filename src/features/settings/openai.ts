import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "../../lib/api/request";

type OpenAIStatus = { available: boolean; configured: boolean; model: string };

const endpoint = "/api/paideuo/v1/settings/openai";
export const openAIQueryKey = (ownerId: string) => ["openai-settings", ownerId] as const;

export const useOpenAIStatus = (ownerId: string, enabled = true) =>
  useQuery({
    queryKey: openAIQueryKey(ownerId),
    queryFn: ({ signal }) => apiRequest<OpenAIStatus>(endpoint, "GET", undefined, signal),
    enabled,
    retry: false,
  });

export const saveOpenAISettings = (payload: { model: string; apiKey?: string }) =>
  apiRequest<OpenAIStatus>(endpoint, "PUT", payload);

export const removeOpenAIKey = () => apiRequest<OpenAIStatus>(endpoint, "DELETE");
