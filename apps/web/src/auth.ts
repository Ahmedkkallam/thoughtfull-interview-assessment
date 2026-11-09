import { useQuery } from "@tanstack/react-query";
import { api, ApiError } from "./api.ts";

export type Me = { id: string; role: "member" | "professional"; name: string; timezone: string; emailReminders: boolean };

// Signed out is a normal answer (null), not an error, so guards can just read it.
export function useMe() {
  return useQuery({
    queryKey: ["me"],
    retry: false,
    queryFn: async () => {
      try {
        return await api<Me>("/api/me");
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
  });
}

export function postJson<T>(path: string, body: unknown) {
  return api<T>(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}
