import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, Navigate, NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { api } from "./api.ts";
import { useMe, type Me } from "./auth.ts";
import { useNotifications } from "./Notifications.tsx";
import { Badge, Button, Callout, LeafIcon, Skeleton, Zone } from "./ui.tsx";

const roleLabel = { member: "Member", professional: "Professional" };

// Links per role; only pages that exist are listed.
const navLinks: Record<Me["role"], { to: string; label: string }[]> = {
  member: [
    { to: "/professionals", label: "Find a professional" },
    { to: "/sessions", label: "My sessions" },
  ],
  professional: [
    { to: "/availability", label: "My hours" },
    { to: "/sessions", label: "My schedule" },
  ],
};

const pill = ({ isActive }: { isActive: boolean }) =>
  `inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full px-4 text-sm font-medium whitespace-nowrap transition-colors duration-150 ${
    isActive ? "bg-brand-700 text-white shadow-sm" : "text-stone-600 hover:bg-stone-100 hover:text-stone-900"
  }`;

function Brand() {
  return (
    <span className="inline-flex items-center gap-2 text-lg font-semibold tracking-tight text-stone-900">
      <span className="inline-flex size-8 items-center justify-center rounded-xl bg-brand-700 text-white">
        <LeafIcon className="size-5" />
      </span>
      ThoughtFull
    </span>
  );
}

function PageLoading() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <Skeleton rows={3} />
    </div>
  );
}

// Signed-out visitors are sent to /login. The API still checks every request itself.
export function RequireAuth() {
  const me = useMe();
  const notifications = useNotifications();
  const unread = notifications.data?.filter((n) => !n.readAt).length;
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const logout = useMutation({
    mutationFn: () => api<void>("/api/auth/logout", { method: "POST" }),
    onSuccess: () => {
      queryClient.clear();
      queryClient.setQueryData(["me"], null);
      navigate("/login");
    },
  });

  if (me.isPending) return <PageLoading />;
  if (me.isError)
    return (
      <div className="mx-auto max-w-4xl px-4 py-10">
        <Callout>Something went wrong: {me.error.message}</Callout>
      </div>
    );
  if (!me.data) return <Navigate to="/login" replace />;

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-stone-200/80 bg-white/85 backdrop-blur">
        <div className="mx-auto max-w-4xl px-4">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-3">
            <Link to="/" className="rounded-xl">
              <Brand />
            </Link>
            <div className="order-last w-full text-xs text-stone-600 sm:order-none sm:ml-auto sm:w-auto sm:text-right">
              <span className="font-medium text-stone-800">{me.data.name}</span> <Badge>{roleLabel[me.data.role]}</Badge>
              <span className="block">
                <Zone prefix="Times shown in " zone={me.data.timezone} />
              </span>
            </div>
            <Button variant="ghost" size="sm" className="ml-auto sm:ml-0" onClick={() => logout.mutate()} disabled={logout.isPending}>
              Log out
            </Button>
          </div>
          <nav aria-label="Main" className="-mx-4 flex gap-1 overflow-x-auto px-4 py-2">
            <NavLink to="/" end className={pill}>
              Home
            </NavLink>
            {navLinks[me.data.role].map((l) => (
              <NavLink key={l.to} to={l.to} className={pill}>
                {l.label}
              </NavLink>
            ))}
            <NavLink to="/notifications" className={pill}>
              Notifications
              {/* Screen readers hear "Notifications (2)"; the badge is the visual version. */}
              {" "}
              {unread !== undefined && <span className="sr-only">({unread})</span>}
              {!!unread && (
                <span
                  aria-hidden="true"
                  className="inline-flex min-w-5 items-center justify-center rounded-full bg-rose-600 px-1.5 text-xs leading-5 font-semibold text-white motion-safe:animate-pop"
                >
                  {unread}
                </span>
              )}
            </NavLink>
          </nav>
        </div>
        {logout.isError && (
          <div className="mx-auto max-w-4xl px-4 pb-3">
            <Callout>{logout.error.message}</Callout>
          </div>
        )}
      </header>
      {/* Keyed by path so each page fades in when you navigate. */}
      <main key={pathname} className="mx-auto max-w-4xl px-4 py-8 sm:py-10 motion-safe:animate-rise">
        <Outlet context={me.data} />
      </main>
    </div>
  );
}

// Signed-in users have no reason to see the login or sign-up forms.
export function PublicOnly() {
  const me = useMe();
  const { pathname } = useLocation();
  if (me.isPending) return <PageLoading />;
  if (me.data) return <Navigate to="/" replace />;
  return (
    <main className="flex min-h-screen items-start justify-center bg-linear-to-br from-brand-50 via-sand-50 to-amber-50 px-4 py-12 sm:items-center">
      <div key={pathname} className="w-full max-w-md motion-safe:animate-rise">
        <div className="mb-6 text-center">
          <h1 className="inline-flex">
            <Brand />
          </h1>
          <p className="mt-2 text-stone-600">A calm place to find support and book your sessions.</p>
        </div>
        <div className="rounded-card border border-stone-200/80 bg-white p-6 shadow-lg shadow-stone-900/5 sm:p-8">
          <Outlet />
        </div>
      </div>
    </main>
  );
}
