import type { ButtonHTMLAttributes, ReactNode } from "react";
import { zoneLabel, zoneLongName, zoneTitle } from "./format.ts";

// A few shared building blocks so the pages read as content, not as long class strings.

type Variant = "primary" | "secondary" | "ghost" | "danger";

const variants: Record<Variant, string> = {
  primary: "bg-brand-700 text-white shadow-sm hover:bg-brand-800",
  secondary: "border border-stone-300 bg-white text-stone-800 hover:border-stone-400 hover:bg-stone-50",
  ghost: "text-brand-700 hover:bg-brand-50",
  danger: "bg-rose-700 text-white shadow-sm hover:bg-rose-800",
};

// Also used on <Link>s that should look like buttons. min-h-11 keeps a 44 px touch target.
export function buttonClass(variant: Variant = "primary", size: "sm" | "md" = "md") {
  const sizing = size === "sm" ? "min-h-11 px-3 text-sm" : "min-h-11 px-5";
  return `inline-flex items-center justify-center gap-2 rounded-xl font-medium no-underline transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 ${sizing} ${variants[variant]}`;
}

export function Button({
  variant,
  size,
  className = "",
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" }) {
  return <button type={type} className={`${buttonClass(variant, size)} ${className}`} {...props} />;
}

export function Card({ className = "", children }: { className?: string; children: ReactNode }) {
  return <div className={`rounded-card border border-stone-200/80 bg-white p-5 shadow-sm sm:p-6 ${className}`}>{children}</div>;
}

export function PageHeader({ title, subtitle }: { title: ReactNode; subtitle?: ReactNode }) {
  return (
    <div className="mb-6">
      <h1 className="text-2xl font-semibold tracking-tight text-stone-900 sm:text-3xl">{title}</h1>
      {subtitle && <p className="mt-1 text-stone-600">{subtitle}</p>}
    </div>
  );
}

const badgeTones = {
  brand: "bg-brand-50 text-brand-800 ring-brand-200",
  rose: "bg-rose-50 text-rose-800 ring-rose-200",
  muted: "bg-stone-100 text-stone-700 ring-stone-200",
};

export function Badge({ tone = "muted", children }: { tone?: keyof typeof badgeTones; children: ReactNode }) {
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${badgeTones[tone]}`}>{children}</span>;
}

export const inputClass =
  "block min-h-11 w-full rounded-xl border border-stone-300 bg-white px-3.5 text-stone-900 shadow-xs transition-colors placeholder:text-stone-400 hover:border-stone-400 focus:border-brand-600 aria-invalid:border-rose-600 aria-invalid:bg-rose-50";

export function Field({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-stone-700">
        {label}
      </label>
      {children}
    </div>
  );
}

const calloutTones = {
  error: "border-rose-200 bg-rose-50 text-rose-900",
  info: "border-brand-200 bg-brand-50 text-brand-900",
  warning: "border-amber-200 bg-amber-50 text-amber-900",
};

// Errors are announced (role="alert") by default. The icon has no text, so the message stays the element's whole text.
export function Callout({
  tone = "error",
  role = tone === "error" ? "alert" : undefined,
  children,
}: {
  tone?: keyof typeof calloutTones;
  role?: "alert" | "status";
  children: ReactNode;
}) {
  return (
    <div role={role} className={`flex items-start gap-3 rounded-xl border px-4 py-3 text-sm motion-safe:animate-fade ${calloutTones[tone]}`}>
      {tone === "error" ? <AlertIcon className="mt-0.5 size-4 shrink-0" /> : <InfoIcon className="mt-0.5 size-4 shrink-0" />}
      <div className="min-w-0">{children}</div>
    </div>
  );
}

// Placeholder blocks while a request is in flight; screen readers hear "Loading…".
export function Skeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div role="status" className="space-y-3">
      <span className="sr-only">Loading…</span>
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          aria-hidden="true"
          className="h-16 rounded-xl bg-stone-200/70 bg-[length:200%_100%] motion-safe:animate-shimmer motion-safe:bg-linear-to-r motion-safe:from-stone-200/70 motion-safe:via-stone-100 motion-safe:to-stone-200/70"
        />
      ))}
    </div>
  );
}

// Initials in a soft circle; decorative because the name is always written next to it.
export function Avatar({ name, size = "md" }: { name: string; size?: "md" | "lg" }) {
  const initials = name
    .replace(/^Dr\.?\s+/i, "")
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  const sizing = size === "lg" ? "size-14 text-lg" : "size-11 text-sm";
  return (
    <span aria-hidden="true" className={`inline-flex shrink-0 items-center justify-center rounded-full bg-brand-100 font-semibold text-brand-800 ${sizing}`}>
      {initials}
    </span>
  );
}

// "Times shown in Singapore time": the IANA id and the long name are on hover; `long` also writes the long name out
// where there is room. The prefix lives in the same element so the sentence reads (and is found) as one.
export function Zone({ zone, prefix = "", long = false }: { zone: string; prefix?: string; long?: boolean }) {
  const longName = zoneLongName(zone);
  return (
    <span title={zoneTitle(zone)}>
      {prefix}
      {zoneLabel(zone)}
      {long && <span className="text-stone-500"> · {longName}</span>}
    </span>
  );
}

// ---- icons (decorative, 24px grid, stroke follows the text colour) ----
type IconProps = { className?: string };
function Icon({ className = "size-5", children }: IconProps & { children: ReactNode }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={className}>
      {children}
    </svg>
  );
}

export const LeafIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5 19c0-8 5-13 14-14 0 9-5 14-13 14Z" />
    <path d="M5 19c3-4 6-7 10-9" />
  </Icon>
);
export const CheckIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </Icon>
);
export const BellIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15Z" />
    <path d="M10 21h4" />
  </Icon>
);
export const CalendarIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3.5" y="5" width="17" height="15" rx="3" />
    <path d="M3.5 10h17M8 3v4M16 3v4" />
  </Icon>
);
export const ClockIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </Icon>
);
export const CrossIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M7 7l10 10M17 7 7 17" />
  </Icon>
);
export const PlusIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);
export const ArrowLeftIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M19 12H5M11 6l-6 6 6 6" />
  </Icon>
);
export const ArrowRightIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </Icon>
);
function AlertIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 8v4.5M12 16h.01" />
    </Icon>
  );
}
function InfoIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5M12 8h.01" />
    </Icon>
  );
}
