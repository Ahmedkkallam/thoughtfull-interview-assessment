import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { postJson, type Me } from "./auth.ts";
import { Button, Callout, Field, inputClass } from "./ui.tsx";

export function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const login = useMutation({
    mutationFn: () => postJson<Me>("/api/auth/login", { email, password }),
    onSuccess: (user) => {
      queryClient.setQueryData(["me"], user);
      navigate("/");
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    login.mutate();
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-stone-900">Log in</h2>
        <p className="mt-1 text-sm text-stone-600">Welcome back. It's good to see you.</p>
      </div>
      <Field id="email" label="Email">
        <input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} />
      </Field>
      <Field id="password" label="Password">
        <input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} />
      </Field>
      {login.isError && <Callout>{login.error.message}</Callout>}
      <Button type="submit" disabled={login.isPending} className="w-full">
        {login.isPending ? "Logging in…" : "Log in"}
      </Button>
      <p className="text-center text-sm text-stone-600">
        New here?{" "}
        <Link to="/signup" className="font-medium text-brand-700 underline-offset-4 hover:underline">
          Create an account
        </Link>
      </p>
    </form>
  );
}
