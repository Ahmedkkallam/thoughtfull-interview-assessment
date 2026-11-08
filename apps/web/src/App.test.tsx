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

const pro = { ...user, role: "professional", name: "Dr. Mira" };
const monday = { weekday: 1, start: "09:00", end: "12:00" };

test("the editor shows the saved ranges for each day in the professional's timezone", async () => {
  mockApi({ "GET /api/me": () => json(pro), "GET /api/availability": () => json([monday, { weekday: 1, start: "13:00", end: "17:00" }]) });
  renderAt("/availability");
  expect(((await screen.findByLabelText("Monday range 1 start")) as HTMLInputElement).value).toBe("09:00");
  expect((screen.getByLabelText("Monday range 2 end") as HTMLInputElement).value).toBe("17:00");
  expect(screen.queryByLabelText("Tuesday range 1 start")).toBeNull();
  expect(screen.getByText(/Times are in your timezone \(Europe\/London\)/)).toBeTruthy();
});

test("adding a range and saving sends the whole week", async () => {
  const fetchMock = mockApi({
    "GET /api/me": () => json(pro),
    "GET /api/availability": () => json([monday]),
    "PUT /api/availability": () => json([]),
  });
  renderAt("/availability");
  await screen.findByLabelText("Monday range 1 start");
  fireEvent.click(screen.getByRole("button", { name: "Add hours for Tuesday" }));
  fireEvent.click(screen.getByRole("button", { name: "Save week" }));
  expect(await screen.findByText("Saved")).toBeTruthy();
  const call = fetchMock.mock.calls.find(([, i]) => i?.method === "PUT")!;
  expect(JSON.parse(call[1]!.body as string)).toEqual({
    hours: [monday, { weekday: 2, start: "09:00", end: "17:00" }],
  });
});

test("removing a range leaves it out of the saved week", async () => {
  const fetchMock = mockApi({
    "GET /api/me": () => json(pro),
    "GET /api/availability": () => json([monday, { weekday: 3, start: "10:00", end: "11:00" }]),
    "PUT /api/availability": () => json([]),
  });
  renderAt("/availability");
  await screen.findByLabelText("Monday range 1 start");
  fireEvent.click(screen.getByRole("button", { name: "Remove Monday range 1" }));
  fireEvent.click(screen.getByRole("button", { name: "Save week" }));
  await screen.findByText("Saved");
  const call = fetchMock.mock.calls.find(([, i]) => i?.method === "PUT")!;
  expect(JSON.parse(call[1]!.body as string)).toEqual({ hours: [{ weekday: 3, start: "10:00", end: "11:00" }] });
});

test("overlapping hours show the server's message", async () => {
  const message = "weekday 1: 09:00-12:00 overlaps 11:00-13:00";
  mockApi({
    "GET /api/me": () => json(pro),
    "GET /api/availability": () => json([monday]),
    "PUT /api/availability": () => json({ error: { code: "INVALID_HOURS", message } }, 400),
  });
  renderAt("/availability");
  await screen.findByLabelText("Monday range 1 start");
  fireEvent.click(screen.getByRole("button", { name: "Save week" }));
  expect((await screen.findByRole("alert")).textContent).toBe(message);
});

test("a member does not see the hours editor", async () => {
  const fetchMock = mockApi({ "GET /api/me": () => json(user) });
  renderAt("/availability");
  expect(await screen.findByText("This page is for professionals.")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Save week" })).toBeNull();
  expect(fetchMock.mock.calls.some(([p]) => p === "/api/availability")).toBe(false);
});
