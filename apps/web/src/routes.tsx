import type { RouteObject } from "react-router";
import { Home } from "./Home.tsx";
import { PublicOnly, RequireAuth } from "./Layout.tsx";
import { Login } from "./Login.tsx";
import { Signup } from "./Signup.tsx";

export const routes: RouteObject[] = [
  { element: <RequireAuth />, children: [{ path: "/", element: <Home /> }] },
  {
    element: <PublicOnly />,
    children: [
      { path: "/login", element: <Login /> },
      { path: "/signup", element: <Signup /> },
    ],
  },
];
