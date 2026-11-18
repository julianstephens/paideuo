import PocketBase from "pocketbase";

export const pocketbase = new PocketBase(window.location.origin);
export const accountCollection = "paideuo_users";

export const signIn = (email: string, password: string) =>
  pocketbase.collection(accountCollection).authWithPassword(email, password, { requestKey: null });

export const signOut = () => pocketbase.authStore.clear();
