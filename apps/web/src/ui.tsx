import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from "react";
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

// The one h1 of a page, with an optional primary action on the right (below the title on phones).
export function PageHeader({ title, subtitle, action }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:mb-8 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-stone-900 sm:text-3xl">{title}</h1>
        {subtitle && <p className="mt-1 text-stone-600">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

// A soft icon, one line of explanation and at most one way forward.
export function EmptyState({ icon, title, children, action }: { icon: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-card border border-dashed border-stone-300 bg-white/60 px-6 py-10 text-center motion-safe:animate-fade">
      <span aria-hidden="true" className="inline-flex size-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-700">
        {icon}
      </span>
      <p className="mt-4 font-semibold text-stone-900">{title}</p>
      {children && <p className="mt-1 max-w-sm text-sm text-stone-600">{children}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

// Lists rise in one after another; capped so a long list never waits. Reduced motion turns the animation off.
export const stagger = (i: number): CSSProperties => ({ animationDelay: `${Math.min(i, 8) * 40}ms` });

const badgeTones = {
  brand: "bg-brand-50 text-brand-800 ring-brand-200",
  rose: "bg-rose-50 text-rose-800 ring-rose-200",
  muted: "bg-stone-100 text-stone-700 ring-stone-200",
};

// The visual half of an on/off switch; the surrounding <button role="switch" aria-checked> carries the meaning.
export function SwitchTrack({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-200 ${on ? "bg-brand-700" : "bg-stone-300 group-hover:bg-stone-400"}`}
    >
      <span className={`inline-block size-5 rounded-full bg-white shadow-sm transition-transform duration-200 ${on ? "translate-x-5.5" : "translate-x-0.5"}`} />
    </span>
  );
}

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

// Placeholders while a request is in flight; screen readers hear "Loading…". Pages arrange Bones in the shape of
// the content that is coming, so nothing jumps when it arrives.
export function Loading({ className = "", children }: { className?: string; children: ReactNode }) {
  return (
    <div role="status" className={className}>
      <span className="sr-only">Loading…</span>
      {children}
    </div>
  );
}

export function Bone({ className = "h-16" }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`rounded-xl bg-stone-200/70 bg-[length:200%_100%] motion-safe:animate-shimmer motion-safe:bg-linear-to-r motion-safe:from-stone-200/70 motion-safe:via-stone-100 motion-safe:to-stone-200/70 ${className}`}
    />
  );
}

export function Skeleton({ rows = 3 }: { rows?: number }) {
  return (
    <Loading className="space-y-3">
      {Array.from({ length: rows }, (_, i) => (
        <Bone key={i} />
      ))}
    </Loading>
  );
}

export function Brand({ tone = "dark" }: { tone?: "dark" | "light" }) {
  return (
    <span className={`inline-flex items-center gap-2.5 text-lg font-semibold tracking-tight ${tone === "dark" ? "text-stone-900" : "text-white"}`}>
      <span className={`inline-flex size-9 items-center justify-center rounded-xl ${tone === "dark" ? "bg-brand-700 text-white" : "bg-white/15 text-white ring-1 ring-white/25"}`}>
        <LeafIcon className="size-5" />
      </span>
      ThoughtFull
    </span>
  );
}

// Initials in a soft circle; decorative because the name is always written next to it.
export function Avatar({ name, size = "md" }: { name: string; size?: "sm" | "md" | "lg" | "xl" }) {
  const initials = name
    .replace(/^Dr\.?\s+/i, "")
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  const sizing = { sm: "size-9 text-xs", md: "size-11 text-sm", lg: "size-14 text-lg", xl: "size-16 text-xl" }[size];
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
export const HomeIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 10.5 12 4l8 6.5V19a1.5 1.5 0 0 1-1.5 1.5H15v-6H9v6H5.5A1.5 1.5 0 0 1 4 19Z" />
  </Icon>
);
export const SearchIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m16 16 4 4" />
  </Icon>
);
export const LogoutIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4M10 16l-4-4 4-4M6 12h10" />
  </Icon>
);
export const ChevronDownIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="m6 9 6 6 6-6" />
  </Icon>
);
export const CopyIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="8.5" y="8.5" width="11" height="11" rx="2.5" />
    <path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5" />
  </Icon>
);
export const SettingsIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5 7h9M18 7h1M5 17h1M10 17h9" />
    <circle cx="16" cy="7" r="2" />
    <circle cx="8" cy="17" r="2" />
  </Icon>
);
export const InboxIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 13.5 6.5 5h11l2.5 8.5V19H4Z" />
    <path d="M4 13.5h5l1 2h4l1-2h5" />
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
