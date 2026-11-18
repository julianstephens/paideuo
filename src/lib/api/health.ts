export const checkBackendHealth = async (signal: AbortSignal) => {
  const response = await fetch("/api/health", {
    signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("PocketBase is unavailable");
  }

  const health: unknown = await response.json();

  if (typeof health !== "object" || health === null || !("code" in health) || health.code !== 200) {
    throw new Error("Unexpected PocketBase health response");
  }

  return true;
};
