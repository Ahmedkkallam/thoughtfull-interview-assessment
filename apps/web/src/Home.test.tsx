import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { ApiStatus } from "./Home.tsx";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderStatus() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ApiStatus />
    </QueryClientProvider>,
  );
}

test("shows the API as ok once the health check answers", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }))));
  renderStatus();
  expect(screen.getByRole("status").textContent).toContain("checking");
  expect((await screen.findByText("API status: ok")).textContent).toBe("API status: ok");
});

test("shows the server's message when the health check fails", async () => {
  const body = { error: { code: "down", message: "Database is down" } };
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 503 })));
  renderStatus();
  expect((await screen.findByRole("alert")).textContent).toContain("Database is down");
});
