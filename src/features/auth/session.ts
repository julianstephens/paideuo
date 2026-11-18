import { createContext, useContext } from "react";

export type Session =
  | { status: "loading" }
  | { status: "signed-out" }
  | { status: "unavailable"; retry: () => void }
  | { status: "signed-in"; ownerId: string };

export const SessionContext = createContext<Session>({ status: "loading" });
export const useSession = () => useContext(SessionContext);
