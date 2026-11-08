import type { RouteObject } from "react-router";
import { Availability } from "./Availability.tsx";
import { Home } from "./Home.tsx";
import { PublicOnly, RequireAuth } from "./Layout.tsx";
import { Login } from "./Login.tsx";
import { Signup } from "./Signup.tsx";

export const routes: RouteObject[] = [
  {
    element: <RequireAuth />,
    children: [
      { path: "/", element: <Home /> },
      { path: "/availability", element: <Availability /> },
    ],
  },
  {
    element: <PublicOnly />,
    children: [
      { path: "/login", element: <Login /> },
      { path: "/signup", element: <Signup /> },
    ],
  },
];
