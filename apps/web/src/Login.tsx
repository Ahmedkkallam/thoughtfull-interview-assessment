import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { postJson, type Me } from "./auth.ts";

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
    <form onSubmit={submit}>
      <h2>Log in</h2>
      <label htmlFor="email">Email</label>
      <input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      <label htmlFor="password">Password</label>
      <input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
      {login.isError && <p role="alert" className="error">{login.error.message}</p>}
      <button type="submit" disabled={login.isPending}>{login.isPending ? "Logging in…" : "Log in"}</button>
      <p>New here? <Link to="/signup">Create an account</Link></p>
    </form>
  );
}
