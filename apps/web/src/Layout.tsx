import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Navigate, Outlet, useNavigate } from "react-router";
import { api } from "./api.ts";
import { useMe } from "./auth.ts";

const roleLabel = { member: "Member", professional: "Professional" };

// Signed-out visitors are sent to /login. The API still checks every request itself.
export function RequireAuth() {
  const me = useMe();
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
