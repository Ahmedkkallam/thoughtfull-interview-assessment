import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { postJson, type Me } from "./auth.ts";

// The browser's own zone is the default; it is added if the list lacks it (e.g. Asia/Kolkata in some engines).
function timezoneOptions(browserZone: string) {
  const zones = Intl.supportedValuesOf("timeZone");
  return zones.includes(browserZone) ? zones : [browserZone, ...zones].sort();
}

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
    <form onSubmit={submit}>
      <h2>Create your account</h2>
      <label htmlFor="name">Name</label>
      <input id="name" autoComplete="name" required value={name} onChange={(e) => setName(e.target.value)} />
      <label htmlFor="email">Email</label>
      <input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      <label htmlFor="password">Password (at least 8 characters)</label>
      <input id="password" type="password" autoComplete="new-password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
      <fieldset>
        <legend>I am</legend>
        <label className="inline">
          <input type="radio" name="role" value="member" checked={role === "member"} onChange={() => setRole("member")} />
          I'm looking for support
        </label>
        <label className="inline">
          <input type="radio" name="role" value="professional" checked={role === "professional"} onChange={() => setRole("professional")} />
          I'm a professional
        </label>
      </fieldset>
      <label htmlFor="timezone">Your timezone</label>
      <select id="timezone" value={timezone} onChange={(e) => setTimezone(e.target.value)}>
        {timezoneOptions(browserZone).map((z) => (
          <option key={z} value={z}>{z}</option>
        ))}
      </select>
      {signup.isError && <p role="alert" className="error">{signup.error.message}</p>}
      <button type="submit" disabled={signup.isPending}>{signup.isPending ? "Creating account…" : "Sign up"}</button>
      <p>Already have an account? <Link to="/login">Log in</Link></p>
    </form>
  );
}
