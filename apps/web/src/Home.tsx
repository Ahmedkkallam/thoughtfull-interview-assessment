import type { ReactNode } from "react";
import { Link, useOutletContext } from "react-router";
import type { Me } from "./auth.ts";
import { ArrowRightIcon, BellIcon, CalendarIcon, ClockIcon, LeafIcon } from "./ui.tsx";

const steps: Record<Me["role"], { to: string; title: string; text: string; icon: ReactNode }[]> = {
  member: [
    { to: "/professionals", title: "Find a professional", text: "Browse counsellors and pick a time that suits you.", icon: <LeafIcon /> },
    { to: "/sessions", title: "My sessions", text: "See, move or cancel the sessions you've booked.", icon: <CalendarIcon /> },
  ],
  professional: [
    { to: "/availability", title: "Set your working hours", text: "Members can book you inside these hours.", icon: <ClockIcon /> },
    { to: "/sessions", title: "My schedule", text: "Your upcoming and past sessions in one place.", icon: <CalendarIcon /> },
  ],
};

export function Home() {
  const me = useOutletContext<Me>();
  return (
    <div className="space-y-6">
      <div className="rounded-card bg-linear-to-br from-brand-700 to-brand-900 p-6 text-white shadow-md sm:p-8">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Welcome, {me.name}</h1>
        <p className="mt-2 max-w-prose text-brand-50">
          {me.role === "member"
            ? "This is your space to find a professional and book a session."
            : "This is your space to set your working hours and see your sessions."}
        </p>
      </div>
      <ul className="grid gap-4 sm:grid-cols-3">
        {[...steps[me.role], { to: "/notifications", title: "Notifications", text: "Reminders and changes to your sessions.", icon: <BellIcon /> }].map((s) => (
          <li key={s.to}>
            <Link
              to={s.to}
              className="group flex h-full flex-col rounded-card border border-stone-200/80 bg-white p-5 shadow-sm transition duration-200 hover:border-brand-200 hover:shadow-md motion-safe:hover:-translate-y-0.5"
            >
              <span className="inline-flex size-10 items-center justify-center rounded-xl bg-brand-50 text-brand-700">{s.icon}</span>
              <span className="mt-4 font-semibold text-stone-900">{s.title}</span>
              <span className="mt-1 flex-1 text-sm text-stone-600">{s.text}</span>
              <ArrowRightIcon className="mt-4 size-5 text-brand-700 transition-transform duration-200 motion-safe:group-hover:translate-x-1" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
