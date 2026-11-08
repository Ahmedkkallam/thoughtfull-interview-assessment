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

const member = { ...user, timezone: "Asia/Singapore" };
const london = { id: "p1", name: "Dr. Mira Okafor", timezone: "Europe/London" };
const slot = { startsAt: "2027-01-04T16:00:00.000Z", endsAt: "2027-01-04T16:50:00.000Z" };

test("the professional list shows names and their timezone", async () => {
  mockApi({ "GET /api/me": () => json(member), "GET /api/professionals": () => json([london]) });
  renderAt("/professionals");
  expect(await screen.findByRole("link", { name: "Dr. Mira Okafor" })).toBeTruthy();
  expect(screen.getByText(/Europe\/London/)).toBeTruthy();
});

test("a London slot appears under the member's Singapore day", async () => {
  mockApi({
    "GET /api/me": () => json(member),
    "GET /api/professionals/p1": () => json(london),
    "GET /api/professionals/p1/slots": () => json({ slots: [slot] }),
  });
  renderAt("/professionals/p1");
  expect(await screen.findByRole("heading", { name: "Tue 5 Jan 2027" })).toBeTruthy();
  expect(screen.getByRole("link", { name: "00:00–00:50" })).toBeTruthy();
  expect(screen.getAllByText("Times shown in Asia/Singapore")).toHaveLength(2); // header and page
});

test("when the clocks go back, repeated times get the zone name and the others stay plain", async () => {
  const ny = { ...member, timezone: "America/New_York" };
  mockApi({
    "GET /api/me": () => json(ny),
    "GET /api/professionals/p1": () => json(london),
    "GET /api/professionals/p1/slots": () =>
      json({
        slots: [
          { startsAt: "2027-11-07T05:00:00.000Z", endsAt: "2027-11-07T05:50:00.000Z" },
          { startsAt: "2027-11-07T06:00:00.000Z", endsAt: "2027-11-07T06:50:00.000Z" },
          { startsAt: "2027-11-07T07:00:00.000Z", endsAt: "2027-11-07T07:50:00.000Z" },
        ],
      }),
  });
  renderAt("/professionals/p1");
  expect(await screen.findByRole("link", { name: "01:00–01:50 EDT" })).toBeTruthy();
  expect(screen.getByRole("link", { name: "01:00–01:50 EST" })).toBeTruthy();
  expect(screen.getByRole("link", { name: "02:00–02:50" })).toBeTruthy();
});

test("no slots shows the empty state", async () => {
  mockApi({
    "GET /api/me": () => json(member),
    "GET /api/professionals/p1": () => json(london),
    "GET /api/professionals/p1/slots": () => json({ slots: [] }),
  });
  renderAt("/professionals/p1");
  expect(await screen.findByText("No free times in the next 4 weeks")).toBeTruthy();
});

const confirmPath = `/professionals/p1/confirm?start=${encodeURIComponent(slot.startsAt)}`;

test("confirming shows the member-zone time and books exactly that slot", async () => {
  const fetchMock = mockApi({
    "GET /api/me": () => json(member),
    "GET /api/professionals/p1": () => json(london),
    "POST /api/sessions": () => json({ id: "s1", ...slot, status: "booked", professional: london }, 201),
  });
  renderAt(confirmPath);
  expect(await screen.findByText("Dr. Mira Okafor")).toBeTruthy();
  expect(screen.getByText("Tue 5 Jan 2027")).toBeTruthy();
  expect(screen.getByText("00:00–00:50 (Asia/Singapore)")).toBeTruthy();
  expect(screen.getByText("50 minutes")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Book session" }));
  expect(await screen.findByText("Booked. You'll get reminders 24 hours and 1 hour before.")).toBeTruthy();
  const call = fetchMock.mock.calls.find(([, i]) => i?.method === "POST")!;
  expect(JSON.parse(call[1]!.body as string)).toEqual({ professionalId: "p1", startsAt: slot.startsAt });
});

test("a taken slot shows the server's message", async () => {
  mockApi({
    "GET /api/me": () => json(member),
    "GET /api/professionals/p1": () => json(london),
    "POST /api/sessions": () => json({ error: { code: "SLOT_TAKEN", message: "This time is no longer available" } }, 409),
  });
  renderAt(confirmPath);
  fireEvent.click(await screen.findByRole("button", { name: "Book session" }));
  expect((await screen.findByRole("alert")).textContent).toContain("This time is no longer available");
  expect(screen.getByRole("link", { name: "Back to the calendar" })).toBeTruthy();
});

test("professionals are told the booking pages are for members", async () => {
  mockApi({ "GET /api/me": () => json(pro) });
  renderAt("/professionals");
  expect(await screen.findByText("This page is for members.")).toBeTruthy();
});

// ---- sessions, cancel, reschedule, notifications ----
const sgMember = { ...user, timezone: "Asia/Singapore" };
const drMira = { id: "p1", name: "Dr. Mira Okafor", timezone: "Europe/London" };
const hoursFromNow = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();
const sessionAt = (id: string, startsAt: string, extra: object = {}) => ({
  id,
  startsAt,
  endsAt: new Date(new Date(startsAt).getTime() + 50 * 60_000).toISOString(),
  status: "booked",
  cancelReason: null,
  counterpart: drMira,
  ...extra,
});
const noNotes = () => json([]);

test("a member sees upcoming sessions in their own timezone with the professional's name", async () => {
  mockApi({
    "GET /api/me": () => json(sgMember),
    "GET /api/notifications": noNotes,
    "GET /api/sessions?scope=upcoming": () => json([sessionAt("s1", "2026-11-12T14:00:00.000Z")]),
    "GET /api/sessions?scope=past": () => json([sessionAt("s0", "2026-10-01T09:00:00.000Z", { status: "cancelled", cancelReason: "member" })]),
  });
  renderAt("/sessions");
  expect(await screen.findByText("Thu 12 Nov 2026")).toBeTruthy();
  expect(screen.getByText(/22:00–22:50 with Dr\. Mira Okafor/)).toBeTruthy();
  expect(await screen.findByText("Cancelled by you")).toBeTruthy();
});

test("a professional sees the member's name and who cancelled", async () => {
  const lina = { id: "m1", name: "Lina Tan", timezone: "Asia/Singapore" };
  mockApi({
    "GET /api/me": () => json({ ...user, role: "professional", name: "Dr. Mira Okafor" }),
    "GET /api/notifications": noNotes,
    "GET /api/sessions?scope=upcoming": () => json([sessionAt("s1", "2026-11-12T14:00:00.000Z", { counterpart: lina })]),
    "GET /api/sessions?scope=past": () =>
      json([sessionAt("s0", "2026-10-01T09:00:00.000Z", { counterpart: lina, status: "cancelled", cancelReason: "member" })]),
  });
  renderAt("/sessions");
  expect(await screen.findByText(/14:00–14:50 with Lina Tan/)).toBeTruthy(); // London is on GMT in November
  expect(await screen.findByText("Cancelled by the member")).toBeTruthy();
});

test("cancelling asks first, posts, and shows success", async () => {
  const fetchMock = mockApi({
    "GET /api/me": () => json(user),
    "GET /api/notifications": noNotes,
    "GET /api/sessions?scope=upcoming": () => json([sessionAt("s1", hoursFromNow(240))]),
    "GET /api/sessions?scope=past": () => json([]),
    "POST /api/sessions/s1/cancel": () => json(sessionAt("s1", hoursFromNow(240), { status: "cancelled", cancelReason: "member" })),
  });
  renderAt("/sessions");
  fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
  expect(screen.getByText("Cancel this session?")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Yes" }));
  expect(await screen.findByText("Session cancelled.")).toBeTruthy();
  expect(fetchMock.mock.calls.some(([p, i]) => p === "/api/sessions/s1/cancel" && i?.method === "POST")).toBe(true);
});

test("a refused cancel shows the server's message", async () => {
  const message = "Sessions can't be cancelled or rescheduled less than 24 hours before they start.";
  mockApi({
    "GET /api/me": () => json(user),
    "GET /api/notifications": noNotes,
    "GET /api/sessions?scope=upcoming": () => json([sessionAt("s1", hoursFromNow(240))]),
    "GET /api/sessions?scope=past": () => json([]),
    "POST /api/sessions/s1/cancel": () => json({ error: { code: "TOO_LATE", message } }, 409),
  });
  renderAt("/sessions");
  fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
  fireEvent.click(screen.getByRole("button", { name: "Yes" }));
  expect((await screen.findByRole("alert")).textContent).toBe(message);
});

test("inside 24 hours the member's buttons are disabled with an explanation", async () => {
  mockApi({
    "GET /api/me": () => json(user),
    "GET /api/notifications": noNotes,
    "GET /api/sessions?scope=upcoming": () => json([sessionAt("s1", hoursFromNow(5))]),
    "GET /api/sessions?scope=past": () => json([]),
  });
  renderAt("/sessions");
  const cancel = (await screen.findByRole("button", { name: "Cancel" })) as HTMLButtonElement;
  expect(cancel.disabled).toBe(true);
  expect((screen.getByRole("button", { name: "Reschedule" }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText("Changes are possible up to 24 hours before the start.")).toBeTruthy();
});

test("a professional can still cancel inside 24 hours", async () => {
  mockApi({
    "GET /api/me": () => json({ ...user, role: "professional" }),
    "GET /api/notifications": noNotes,
    "GET /api/sessions?scope=upcoming": () => json([sessionAt("s1", hoursFromNow(5))]),
    "GET /api/sessions?scope=past": () => json([]),
  });
  renderAt("/sessions");
  expect(((await screen.findByRole("button", { name: "Cancel" })) as HTMLButtonElement).disabled).toBe(false);
});

test("rescheduling posts the new start to the reschedule URL", async () => {
  const old = sessionAt("s1", hoursFromNow(240));
  const fetchMock = mockApi({
    "GET /api/me": () => json(sgMember),
    "GET /api/notifications": noNotes,
    "GET /api/professionals/p1": () => json(drMira),
    "GET /api/sessions?scope=upcoming": () => json([old]),
    "POST /api/sessions/s1/reschedule": () => json({ ...sessionAt("s2", slot.startsAt), professional: drMira }, 201),
  });
  renderAt(`${confirmPath}&reschedule=s1`);
  expect(await screen.findByRole("heading", { name: "Move your session" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Move session" }));
  expect(await screen.findByText("Moved. Your reminders were updated.")).toBeTruthy();
  const call = fetchMock.mock.calls.find(([p]) => p === "/api/sessions/s1/reschedule")!;
  expect(JSON.parse(call[1]!.body as string)).toEqual({ startsAt: slot.startsAt });
  expect(screen.getAllByRole("link", { name: "My sessions" }).length).toBe(2); // header nav and the success message
});

test("the profile in reschedule mode shows a banner and keeps the session id on slot links", async () => {
  mockApi({
    "GET /api/me": () => json(sgMember),
    "GET /api/notifications": noNotes,
    "GET /api/professionals/p1": () => json(drMira),
    "GET /api/professionals/p1/slots": () => json({ slots: [slot] }),
    "GET /api/sessions?scope=upcoming": () => json([sessionAt("s1", "2026-11-12T14:00:00.000Z")]),
  });
  renderAt("/professionals/p1?reschedule=s1");
  expect(await screen.findByText(/Choose a new time for your session on Thu 12 Nov 2026, 22:00/)).toBeTruthy();
  const link = (await screen.findAllByRole("link")).find((l) => l.getAttribute("href")?.includes("/confirm"))!;
  expect(link.getAttribute("href")).toContain("&reschedule=s1");
});

test("notifications read as sentences in the viewer's zone and mark-as-read posts", async () => {
  let readAt: string | null = null;
  const note = (id: string, kind: string, extra: object = {}) => ({
    id,
    kind,
    createdAt: "2026-11-11T14:00:00.000Z",
    readAt: null,
    session: { id: "s1", startsAt: "2026-11-12T14:00:00.000Z", endsAt: "2026-11-12T14:50:00.000Z", counterpart: { name: drMira.name } },
    ...extra,
  });
  const fetchMock = mockApi({
    "GET /api/me": () => json(sgMember),
    "GET /api/notifications": () => json([note("n1", "reminder_24h", { readAt }), note("n2", "session_cancelled", { readAt: "2026-11-11T15:00:00.000Z" })]),
    "POST /api/notifications/n1/read": () => {
      readAt = "2026-11-11T16:00:00.000Z";
      return new Response(null, { status: 204 });
    },
  });
  renderAt("/notifications");
  expect(await screen.findByText("Reminder: your session with Dr. Mira Okafor is on Thu 12 Nov 2026 at 22:00 (24-hour reminder)")).toBeTruthy();
  expect(screen.getByText("Dr. Mira Okafor cancelled your session on Thu 12 Nov 2026, 22:00")).toBeTruthy();
  expect(await screen.findByRole("link", { name: "Notifications (1)" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Mark as read" }));
  await waitFor(() => expect(fetchMock.mock.calls.some(([p, i]) => p === "/api/notifications/n1/read" && i?.method === "POST")).toBe(true));
  expect(await screen.findByRole("link", { name: "Notifications (0)" })).toBeTruthy();
});
