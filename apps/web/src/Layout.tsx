import { Navigate, Outlet, useLocation } from "react-router";
import { AppShell } from "./AppShell.tsx";
import { useMe } from "./auth.ts";
import { Bone, Brand, Callout, CheckIcon, Loading } from "./ui.tsx";

function PageLoading() {
  return (
    <Loading className="mx-auto max-w-4xl space-y-4 px-4 py-10">
      <Bone className="h-9 w-1/3" />
      <Bone className="h-40" />
      <Bone className="h-24" />
    </Loading>
  );
}

// Signed-out visitors are sent to /login. The API still checks every request itself.
export function RequireAuth() {
  const me = useMe();
  if (me.isPending) return <PageLoading />;
  if (me.isError)
    return (
      <div className="mx-auto max-w-4xl px-4 py-10">
        <Callout>Something went wrong: {me.error.message}</Callout>
      </div>
    );
  if (!me.data) return <Navigate to="/login" replace />;
  return <AppShell me={me.data} />;
}

const promises = ["Times in your own timezone", "Reminders before every session", "Change plans up to 24 hours before"];

// Signed-in users have no reason to see the login or sign-up forms.
// Desktop: brand panel on the left, form on the right. Phones: the panel shrinks to a header above the form.
export function PublicOnly() {
  const me = useMe();
  const { pathname } = useLocation();
  if (me.isPending) return <PageLoading />;
  if (me.data) return <Navigate to="/" replace />;
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-2">
      <header className="relative overflow-hidden bg-linear-to-br from-brand-700 via-brand-800 to-brand-900 px-6 py-8 text-white sm:px-10 lg:flex lg:flex-col lg:px-14 lg:py-12">
        {/* Soft light shapes; purely decorative. */}
        <div aria-hidden="true" className="absolute -top-24 -right-24 size-72 rounded-full bg-brand-400/20 blur-3xl" />
        <div aria-hidden="true" className="absolute -bottom-32 -left-16 size-80 rounded-full bg-amber-200/10 blur-3xl" />
        <div className="relative">
          <Brand tone="light" />
        </div>
        <div className="relative mt-6 lg:my-auto">
          <p className="max-w-md text-2xl font-semibold tracking-tight sm:text-3xl lg:text-5xl lg:leading-tight">Support, on your time</p>
          <p className="mt-3 max-w-md text-brand-100 lg:text-lg">A calm place to find a professional and book your sessions.</p>
          <ul className="mt-10 hidden space-y-4 lg:block">
            {promises.map((p) => (
              <li key={p} className="flex items-center gap-3 text-brand-50">
                <span aria-hidden="true" className="inline-flex size-8 items-center justify-center rounded-full bg-white/15 ring-1 ring-white/20">
                  <CheckIcon className="size-4" />
                </span>
                {p}
              </li>
            ))}
          </ul>
        </div>
      </header>
      <main className="flex items-start justify-center bg-sand-50 px-4 py-10 sm:py-14 lg:items-center">
        <div key={pathname} className="w-full max-w-md motion-safe:animate-rise">
          <div className="rounded-card border border-stone-200/80 bg-white p-6 shadow-lg shadow-stone-900/5 sm:p-8">
            <Outlet />
          </div>
        </div>
      </main>
    </div>
  );
}
