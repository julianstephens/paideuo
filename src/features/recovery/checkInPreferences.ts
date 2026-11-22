import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { checkInApi, checkInPreferencesKey } from "./recovery";
import type { PreferenceUpdate } from "./recovery";

export const useCheckInPreferences = (ownerId: string) =>
  useQuery({
    queryKey: checkInPreferencesKey(ownerId),
    queryFn: ({ signal }) => checkInApi.preferences(signal),
    retry: false,
  });

export const useSaveCheckInPreferences = (ownerId: string) => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (change: PreferenceUpdate) => checkInApi.updatePreferences(change),
    onSuccess: async (data) => {
      const queryKey = checkInPreferencesKey(ownerId);
      await client.cancelQueries({ queryKey });
      client.setQueryData(queryKey, data);
    },
  });
};
