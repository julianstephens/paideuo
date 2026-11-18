import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { PropsWithChildren } from "react";
import { ClientResponseError } from "pocketbase";
import type { RecordAuthResponse } from "pocketbase";
import { accountCollection, pocketbase } from "../../lib/api/pocketbase";
import { SessionContext } from "./session";
import type { Session } from "./session";

const { authStore } = pocketbase;
let refresh: Promise<void> | undefined;

const restoreSession = () => {
  if (refresh) return refresh;
  if (!authStore.isValid) {
    if (authStore.token) authStore.clear();
    return Promise.resolve();
  }
  const token = authStore.token;
  refresh = pocketbase
    .send<RecordAuthResponse>(`/api/collections/${accountCollection}/auth-refresh`, {
      method: "POST",
      requestKey: null,
    })
    .then((result) => {
      if (token === authStore.token) authStore.save(result.token, result.record);
    })
    .catch((error: unknown) => {
      if (token !== authStore.token) return;
      if (error instanceof ClientResponseError && [401, 403, 404].includes(error.status)) {
        authStore.clear();
        return;
      }
      throw error;
    })
    .finally(() => {
      refresh = undefined;
    });
  return refresh;
};

export const AuthProvider = ({ children }: PropsWithChildren) => {
  const queryClient = useQueryClient();
  const [session, setSession] = useState<Session>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let disposed = false;
    let expiry: ReturnType<typeof setTimeout> | undefined;
    let previousOwner: string | undefined;
    let initialized = false;

    const sync = () => {
      if (disposed) return;
      clearTimeout(expiry);
      const record =
        authStore.isValid && authStore.record?.collectionName === accountCollection
          ? authStore.record
          : null;
      if (previousOwner !== record?.id) {
        queryClient.removeQueries({ queryKey: ["programs"] });
        queryClient.removeQueries({ queryKey: ["templates"] });
        previousOwner = record?.id;
      }
      if (!initialized) return;
      if (!record) {
        setSession({ status: "signed-out" });
        return;
      }
      setSession({ status: "signed-in", ownerId: record.id });
      const payload = authStore.token.split(".")[1];
      const { exp } = JSON.parse(atob(payload.replaceAll("-", "+").replaceAll("_", "/"))) as {
        exp: number;
      };
      expiry = setTimeout(
        () => {
          if (!authStore.isValid) authStore.clear();
          else sync();
        },
        Math.min(Math.max(exp * 1000 - Date.now() + 1000, 1000), 2_147_483_647),
      );
    };

    const unsubscribe = authStore.onChange(sync);
    void restoreSession().then(
      () => {
        initialized = true;
        sync();
      },
      () => {
        if (!disposed)
          setSession({ status: "unavailable", retry: () => setAttempt((value) => value + 1) });
      },
    );

    return () => {
      disposed = true;
      clearTimeout(expiry);
      unsubscribe();
    };
  }, [attempt, queryClient]);

  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>;
};
