import { Link, useOutletContext } from "react-router";
import type { Me } from "./auth.ts";

export function Home() {
  const me = useOutletContext<Me>();
  return (
    <>
      <h1>Welcome, {me.name}</h1>
      {me.role === "member" ? (
        <>
          <p>This is your space to find a professional and book a session.</p>
          <p>
            <Link to="/professionals">Find a professional</Link>
          </p>
          <p>
            <Link to="/sessions">My sessions</Link>
          </p>
        </>
      ) : (
        <>
          <p>This is your space to set your working hours and see your sessions.</p>
          <p>
            <Link to="/availability">Set your working hours</Link>
          </p>
          <p>
            <Link to="/sessions">My schedule</Link>
          </p>
        </>
      )}
      <p>
        <Link to="/notifications">Notifications</Link>
      </p>
    </>
  );
}
