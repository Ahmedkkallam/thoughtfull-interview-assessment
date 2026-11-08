import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, expect, test, vi } from "vitest";
import { routes } from "./routes.tsx";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const signedOut = () => json({ error: { code: "UNAUTHENTICATED", message: "Please log in" } }, 401);
const user = { id: "u1", role: "member", name: "Amira", timezone: "Europe/London" };

// Routes a mocked fetch by "METHOD path"; unknown calls fail loudly.
function mockApi(handlers: Record<string, () => Response>) {
  const fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
    const handler = handlers[`${init?.method ?? "GET"} ${path}`];
    if (!handler) throw new Error(`unmocked ${init?.method ?? "GET"} ${path}`);
    return handler();
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

const type = (label: string | RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

test("a signed-out visitor is sent to the login page", async () => {
  mockApi({ "GET /api/me": signedOut });
  const router = renderAt("/");
  expect(await screen.findByRole("heading", { name: "Log in" })).toBeTruthy();
  expect(router.state.location.pathname).toBe("/login");
});

test("signing up sends the chosen role and timezone, then lands on the home page", async () => {
  const pro = { ...user, role: "professional", name: "Dr. Mira" };
  let me = signedOut;
  const fetchMock = mockApi({
    "GET /api/me": () => me(),
    "POST /api/auth/signup": () => {
      me = () => json(pro);
      return json(pro, 201);
    },
  });
  const router = renderAt("/signup");
  await screen.findByLabelText("Name");
  type("Name", "Dr. Mira");
  type("Email", "mira@example.com");
  type(/^Password/, "correct horse");
  fireEvent.click(screen.getByLabelText("I'm a professional"));
  type("Your timezone", "Asia/Singapore");
  fireEvent.click(screen.getByRole("button", { name: "Sign up" }));

  await waitFor(() => expect(router.state.location.pathname).toBe("/"));
  const call = fetchMock.mock.calls.find(([p]) => p === "/api/auth/signup")!;
  expect(JSON.parse(call[1]!.body as string)).toEqual({
    name: "Dr. Mira",
    email: "mira@example.com",
    password: "correct horse",
    role: "professional",
    timezone: "Asia/Singapore",
  });
  expect(await screen.findByText("Welcome, Dr. Mira")).toBeTruthy();
  expect(screen.getByText("Times shown in Europe/London")).toBeTruthy();
});

test("the timezone picker starts on the browser's timezone", async () => {
  mockApi({ "GET /api/me": signedOut });
  renderAt("/signup");
  const select = (await screen.findByLabelText("Your timezone")) as HTMLSelectElement;
  expect(select.value).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
});

test("a wrong password shows the server's message", async () => {
  mockApi({
    "GET /api/me": signedOut,
    "POST /api/auth/login": () => json({ error: { code: "INVALID_CREDENTIALS", message: "Email or password is incorrect" } }, 401),
  });
  renderAt("/login");
  await screen.findByLabelText("Email");
  type("Email", "a@example.com");
  type("Password", "wrong-password");
  fireEvent.click(screen.getByRole("button", { name: "Log in" }));
  expect((await screen.findByRole("alert")).textContent).toBe("Email or password is incorrect");
});

test("logging out calls the API and returns to the login page", async () => {
  let signedIn = true;
  const fetchMock = mockApi({
    "GET /api/me": () => (signedIn ? json(user) : signedOut()),
    "POST /api/auth/logout": () => {
      signedIn = false;
      return new Response(null, { status: 204 });
    },
  });
  const router = renderAt("/");
  expect(await screen.findByText("Welcome, Amira")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Log out" }));
  await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
  expect(fetchMock.mock.calls.some(([p, i]) => p === "/api/auth/logout" && i?.method === "POST")).toBe(true);
});

test("a signed-in user visiting the login page is sent home", async () => {
  mockApi({ "GET /api/me": () => json(user) });
  const router = renderAt("/login");
  expect(await screen.findByText("Welcome, Amira")).toBeTruthy();
  expect(router.state.location.pathname).toBe("/");
});
