import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { postJson, type Me } from "./auth.ts";
import { zoneOption } from "./format.ts";
import { Button, Callout, Field, inputClass } from "./ui.tsx";

// The browser's own zone is the default; it is added if the list lacks it (e.g. Asia/Kolkata in some engines).
function timezoneOptions(browserZone: string) {
  const zones = Intl.supportedValuesOf("timeZone");
  return zones.includes(browserZone) ? zones : [browserZone, ...zones].sort();
}

const roles: { value: Me["role"]; title: string; hint: string }[] = [
  { value: "member", title: "I'm looking for support", hint: "Find a professional and book sessions." },
  { value: "professional", title: "I'm a professional", hint: "Set your hours and see your schedule." },
];

export function Signup() {
  const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Me["role"]>("member");
  const [timezone, setTimezone] = useState(browserZone);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const signup = useMutation({
    mutationFn: () => postJson<Me>("/api/auth/signup", { name, email, password, role, timezone }),
    onSuccess: (user) => {
      queryClient.setQueryData(["me"], user);
      navigate("/");
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    signup.mutate();
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-stone-900">Create your account</h1>
        <p className="mt-1 text-sm text-stone-600">It only takes a minute.</p>
      </div>
      <Field id="name" label="Name">
        <input id="name" autoComplete="name" required value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
      </Field>
      <Field id="email" label="Email">
        <input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} />
      </Field>
      <Field id="password" label="Password (at least 8 characters)">
        <input id="password" type="password" autoComplete="new-password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} />
      </Field>
      <fieldset>
        <legend className="mb-1.5 text-sm font-medium text-stone-700">I am</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {/* Real radio inputs; the label stretches over the whole card so any click on it selects. */}
          {roles.map((r) => (
            <div
              key={r.value}
              className="relative rounded-xl border border-stone-300 bg-white p-4 transition-colors duration-150 hover:border-brand-400 has-checked:border-brand-600 has-checked:bg-brand-50 has-checked:ring-1 has-checked:ring-brand-600 has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-brand-600"
            >
              <input
                id={`role-${r.value}`}
                type="radio"
                name="role"
                value={r.value}
                checked={role === r.value}
                onChange={() => setRole(r.value)}
                aria-describedby={`role-${r.value}-hint`}
                className="absolute top-4 right-4 size-4 accent-brand-700 focus-visible:outline-none"
              />
              <label htmlFor={`role-${r.value}`} className="block cursor-pointer pr-6 font-medium text-stone-900 after:absolute after:inset-0">
                {r.title}
              </label>
              <p id={`role-${r.value}-hint`} className="mt-1 text-sm text-stone-600">
                {r.hint}
              </p>
            </div>
          ))}
        </div>
      </fieldset>
      <Field id="timezone" label="Your timezone">
        <select id="timezone" value={timezone} onChange={(e) => setTimezone(e.target.value)} className={inputClass}>
          {timezoneOptions(browserZone).map((z) => (
            <option key={z} value={z}>
              {zoneOption(z)}
            </option>
          ))}
        </select>
      </Field>
      {signup.isError && <Callout>{signup.error.message}</Callout>}
      <Button type="submit" disabled={signup.isPending} className="w-full">
        {signup.isPending ? "Creating account…" : "Sign up"}
      </Button>
      <p className="text-center text-sm text-stone-600">
        Already have an account?{" "}
        <Link to="/login" className="font-medium text-brand-700 underline-offset-4 hover:underline">
          Log in
        </Link>
      </p>
    </form>
  );
}
