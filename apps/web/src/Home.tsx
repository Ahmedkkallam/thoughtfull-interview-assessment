import { useQuery } from "@tanstack/react-query";
import { api } from "./api.ts";

export function ApiStatus() {
  const health = useQuery({ queryKey: ["health"], queryFn: () => api<{ ok: boolean }>("/api/health") });

  if (health.isPending) return <p role="status">API status: checking…</p>;
  if (health.isError) return <p role="alert">API status: unavailable ({health.error.message})</p>;
  return <p role="status">API status: {health.data.ok ? "ok" : "not ok"}</p>;
}

export function Home() {
  return (
    <main>
      <h1>ThoughtFull</h1>
      <ApiStatus />
    </main>
  );
}
