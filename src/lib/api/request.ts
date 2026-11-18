import { ClientResponseError } from "pocketbase";
import { pocketbase } from "./pocketbase";

export const apiRequest = async <T>(
  path: string,
  method = "GET",
  body?: object,
  signal?: AbortSignal,
) => {
  const token = pocketbase.authStore.token;
  try {
    return await pocketbase.send<T>(path, { method, body, signal, requestKey: null });
  } catch (error) {
    if (
      error instanceof ClientResponseError &&
      error.status === 401 &&
      token === pocketbase.authStore.token
    ) {
      pocketbase.authStore.clear();
    }
    throw error;
  }
};

export const errorMessage = (error: unknown, fallback: string) => {
  if (error instanceof ClientResponseError && error.status >= 400 && error.status < 500) {
    return error.response.message || fallback;
  }
  return fallback;
};
