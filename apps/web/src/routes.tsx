import type { RouteObject } from "react-router";
import { Availability } from "./Availability.tsx";
import { Home } from "./Home.tsx";
import { PublicOnly, RequireAuth } from "./Layout.tsx";
import { Login } from "./Login.tsx";
import { BookingConfirm, ProfessionalList, ProfessionalProfile } from "./Professionals.tsx";
import { NotificationList } from "./Notifications.tsx";
import { Sessions } from "./Sessions.tsx";
import { Signup } from "./Signup.tsx";

export const routes: RouteObject[] = [
  {
    element: <RequireAuth />,
    children: [
      { path: "/", element: <Home /> },
      { path: "/sessions", element: <Sessions /> },
      { path: "/notifications", element: <NotificationList /> },
      { path: "/availability", element: <Availability /> },
      { path: "/professionals", element: <ProfessionalList /> },
      { path: "/professionals/:id", element: <ProfessionalProfile /> },
      { path: "/professionals/:id/confirm", element: <BookingConfirm /> },
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
