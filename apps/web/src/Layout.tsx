import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Navigate, NavLink, Outlet, useNavigate } from "react-router";
import { api } from "./api.ts";
import { useMe, type Me } from "./auth.ts";
import { useNotifications } from "./Notifications.tsx";

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

// Signed-out visitors are sent to /login. The API still checks every request itself.
export function RequireAuth() {
  const me = useMe();
  const notifications = useNotifications();
  const unread = notifications.data?.filter((n) => !n.readAt).length;
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const logout = useMutation({
    mutationFn: () => api<void>("/api/auth/logout", { method: "POST" }),
    onSuccess: () => {
      queryClient.clear();
      queryClient.setQueryData(["me"], null);
      navigate("/login");
    },
  });

  if (me.isPending) return <p role="status" className="page">Loading…</p>;
  if (me.isError) return <p role="alert" className="page">Something went wrong: {me.error.message}</p>;
  if (!me.data) return <Navigate to="/login" replace />;

  return (
    <>
      <header className="header">
        <strong>ThoughtFull</strong>
        <nav aria-label="Main" className="nav">
          <NavLink to="/">Home</NavLink>
          {navLinks[me.data.role].map((l) => (
            <NavLink key={l.to} to={l.to}>
              {l.label}
            </NavLink>
          ))}
          <NavLink to="/notifications">Notifications{unread === undefined ? "" : ` (${unread})`}</NavLink>
        </nav>
        <span>
          {me.data.name} ({roleLabel[me.data.role]})
        </span>
        <span>Times shown in {me.data.timezone}</span>
        <button type="button" onClick={() => logout.mutate()} disabled={logout.isPending}>
          Log out
        </button>
        {logout.isError && <span role="alert">{logout.error.message}</span>}
      </header>
      <main className="page">
        <Outlet context={me.data} />
      </main>
    </>
  );
}

// Signed-in users have no reason to see the login or sign-up forms.
export function PublicOnly() {
  const me = useMe();
  if (me.isPending) return <p role="status" className="page">Loading…</p>;
  if (me.data) return <Navigate to="/" replace />;
  return (
    <main className="page narrow">
      <h1>ThoughtFull</h1>
      <Outlet />
    </main>
  );
}
