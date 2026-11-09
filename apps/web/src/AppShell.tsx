import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { api } from "./api.ts";
import type { Me } from "./auth.ts";
import { useNotifications } from "./Notifications.tsx";
import { Avatar, Badge, BellIcon, Brand, Button, buttonClass, CalendarIcon, Callout, ClockIcon, HomeIcon, LogoutIcon, SearchIcon, SettingsIcon, Zone } from "./ui.tsx";

const roleLabel = { member: "Member", professional: "Professional" };

// `short` is the visible label in the phone tab bar; the full label stays the link's name everywhere.
// `desktopOnly` items live in the avatar menu on phones, keeping the tab bar to four.
type NavItem = { to: string; label: string; short?: string; icon: ReactNode; desktopOnly?: boolean };

const navItems: Record<Me["role"], NavItem[]> = {
  member: [
    { to: "/professionals", label: "Find a professional", short: "Find", icon: <SearchIcon /> },
    { to: "/sessions", label: "My sessions", short: "Sessions", icon: <CalendarIcon /> },
  ],
  professional: [
    { to: "/availability", label: "My hours", short: "Hours", icon: <ClockIcon /> },
    { to: "/sessions", label: "My schedule", short: "Schedule", icon: <CalendarIcon /> },
  ],
};

// Phones: an icon over a small label, filling the bottom bar. Desktop: a row in the sidebar; the active page is a teal pill.
const navLink = ({ isActive }: { isActive: boolean }) =>
  `relative flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl text-[11px] font-medium transition-colors duration-150 lg:min-h-11 lg:flex-none lg:flex-row lg:justify-start lg:gap-3 lg:px-3 lg:text-sm ${
    isActive ? "text-brand-800 lg:bg-brand-50" : "text-stone-500 hover:text-stone-900 lg:text-stone-600 lg:hover:bg-stone-100"
  }`;

function useLogout() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: () => api<void>("/api/auth/logout", { method: "POST" }),
    onSuccess: () => {
      queryClient.clear();
      queryClient.setQueryData(["me"], null);
      navigate("/login");
    },
  });
}

export function AppShell({ me }: { me: Me }) {
  const notifications = useNotifications();
  const unread = notifications.data?.filter((n) => !n.readAt).length;
  const logout = useLogout();
  const { pathname } = useLocation();

  const items: NavItem[] = [
    { to: "/", label: "Home", icon: <HomeIcon /> },
    ...navItems[me.role],
    { to: "/notifications", label: "Notifications", short: "Inbox", icon: <BellIcon /> },
    { to: "/settings", label: "Settings", icon: <SettingsIcon />, desktopOnly: true },
  ];

  return (
    <div className="min-h-screen lg:pl-64">
      <a href="#main" className="sr-only z-50 rounded-xl bg-white px-4 py-2 focus:not-sr-only focus:fixed focus:top-3 focus:left-3">
        Skip to content
      </a>

      {/* Phones and tablets: a compact top bar. */}
      <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-stone-200/80 bg-white/85 px-4 backdrop-blur sm:px-6 lg:hidden">
        <Link to="/" className="rounded-xl">
          <Brand />
        </Link>
        <AccountMenu me={me} onLogout={() => logout.mutate()} loggingOut={logout.isPending} />
      </header>

      {/* One element, two shapes: a bottom tab bar on phones, the fixed sidebar on desktop. */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-stone-200/80 bg-white/90 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:inset-y-0 lg:right-auto lg:flex lg:w-64 lg:flex-col lg:border-t-0 lg:border-r lg:bg-white/70 lg:p-4 lg:pb-4">
        <Link to="/" className="mb-8 hidden rounded-xl px-2 pt-2 lg:block">
          <Brand />
        </Link>
        <nav aria-label="Main" className="mx-auto flex max-w-lg gap-1 px-2 py-1 lg:mx-0 lg:max-w-none lg:flex-col lg:p-0">
          {items.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.to === "/"} className={(s) => `${navLink(s)} ${item.desktopOnly ? "max-lg:hidden" : ""}`}>
              {({ isActive }) => (
                <>
                  <span
                    className={`inline-flex h-7 w-12 items-center justify-center rounded-full transition-colors duration-150 lg:h-auto lg:w-auto ${isActive ? "bg-brand-100 lg:bg-transparent" : ""}`}
                  >
                    {item.icon}
                  </span>
                  {item.short ? (
                    <>
                      <span className="sr-only lg:not-sr-only">{item.label}</span>
                      <span aria-hidden="true" className="lg:hidden">
                        {item.short}
                      </span>
                    </>
                  ) : (
                    <span>{item.label}</span>
                  )}
                  {item.to === "/notifications" && (
                    <>
                      {/* Screen readers hear "Notifications (2)"; the badge is the visual version. */}{" "}
                      {unread !== undefined && <span className="sr-only">({unread})</span>}
                      {!!unread && (
                        <span
                          aria-hidden="true"
                          className="absolute top-1.5 left-1/2 ml-2 inline-flex min-w-5 items-center justify-center rounded-full bg-rose-600 px-1.5 text-xs leading-5 font-semibold text-white motion-safe:animate-pop lg:static lg:ml-auto"
                        >
                          {unread}
                        </span>
                      )}
                    </>
                  )}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="mt-auto hidden rounded-card border border-stone-200/80 bg-white p-3 shadow-sm lg:block">
          <Link to="/settings" className="-m-1 flex items-center gap-3 rounded-xl p-1 hover:bg-stone-50">
            <Avatar name={me.name} size="sm" />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-stone-900">
                <span className="sr-only">Account settings: </span>
                {me.name}
              </p>
              <Badge tone="brand">{roleLabel[me.role]}</Badge>
            </div>
          </Link>
          <p className="mt-2 text-xs text-stone-600">
            <Zone prefix="Times shown in " zone={me.timezone} />
          </p>
          <Button variant="ghost" size="sm" className="mt-1 w-full justify-start text-stone-600" onClick={() => logout.mutate()} disabled={logout.isPending}>
            <LogoutIcon className="size-4" />
            Log out
          </Button>
        </div>
      </div>

      {/* Bottom padding keeps the last item clear of the tab bar on phones. Keyed by path so each page fades in. */}
      <main
        id="main"
        key={pathname}
        className="mx-auto w-full max-w-6xl px-4 pt-6 pb-[calc(6rem+env(safe-area-inset-bottom))] sm:px-6 sm:pt-8 lg:px-10 lg:pt-10 lg:pb-12 motion-safe:animate-rise"
      >
        {logout.isError && (
          <div className="mb-6">
            <Callout>{logout.error.message}</Callout>
          </div>
        )}
        <Outlet context={me} />
      </main>
    </div>
  );
}

// Phones only: name, timezone and Log out behind the avatar. Closes on Escape or a tap elsewhere.
function AccountMenu({ me, onLogout, loggingOut }: { me: Me; onLogout: () => void; loggingOut: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const escape = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="account-menu"
        onClick={() => setOpen(!open)}
        className="inline-flex size-11 items-center justify-center rounded-full"
      >
        <span className="sr-only">Account</span>
        <Avatar name={me.name} size="sm" />
      </button>
      {open && (
        <div
          id="account-menu"
          className="absolute top-full right-0 mt-2 w-64 rounded-card border border-stone-200/80 bg-white p-4 shadow-lg shadow-stone-900/10 motion-safe:animate-fade"
        >
          <p className="font-semibold text-stone-900">{me.name}</p>
          <div className="mt-1">
            <Badge tone="brand">{roleLabel[me.role]}</Badge>
          </div>
          <p className="mt-2 text-sm text-stone-600">
            <Zone prefix="Times shown in " zone={me.timezone} />
          </p>
          <Link to="/settings" onClick={() => setOpen(false)} className={`${buttonClass("ghost", "sm")} mt-3 w-full justify-start`}>
            <SettingsIcon className="size-4" />
            Settings
          </Link>
          <Button variant="secondary" size="sm" className="mt-1 w-full" onClick={onLogout} disabled={loggingOut}>
            <LogoutIcon className="size-4" />
            Log out
          </Button>
        </div>
      )}
    </div>
  );
}
