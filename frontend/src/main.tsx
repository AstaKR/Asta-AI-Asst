import { StrictMode, Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";

import { AuthProvider, RequireAuth, useAuth } from "./auth";
import "./index.css";

// Apply a saved light/dark choice before the first paint (otherwise the theme follows the OS).
try {
  const saved = localStorage.getItem("theme");
  if (saved === "light" || saved === "dark") document.documentElement.setAttribute("data-theme", saved);
} catch {
  /* storage unavailable */
}
import { JoinPage } from "./pages/JoinPage";
import { Landing } from "./pages/Landing";
import { LoginPage } from "./pages/LoginPage";
import { MeetingDetailPage } from "./pages/MeetingDetailPage";
import { MeetingPrintPage } from "./pages/MeetingPrintPage";
import { MeetingsPage } from "./pages/MeetingsPage";
import { NewCallPage } from "./pages/NewCallPage";
import { SettingsPage } from "./pages/SettingsPage";
import { StartPage } from "./pages/StartPage";
import { SummaryPage } from "./pages/SummaryPage";
import { TranslatePage } from "./pages/TranslatePage";

// The call screen pulls in the LiveKit SDK; load it only when a call starts.
const CallPage = lazy(() => import("./pages/CallPage").then((m) => ({ default: m.CallPage })));
const NewMeetingPage = lazy(() => import("./pages/NewMeetingPage").then((m) => ({ default: m.NewMeetingPage })));
const AdminDashboardPage = lazy(() => import("./pages/admin/AdminDashboardPage").then((m) => ({ default: m.AdminDashboardPage })));
const AdminUsersPage = lazy(() => import("./pages/admin/AdminUsersPage").then((m) => ({ default: m.AdminUsersPage })));
const AdminPlansPage = lazy(() => import("./pages/admin/AdminPlansPage").then((m) => ({ default: m.AdminPlansPage })));
const AdminKeysPage = lazy(() => import("./pages/admin/AdminKeysPage").then((m) => ({ default: m.AdminKeysPage })));

/** Admin pages: the server enforces staff-only access; this just hides them from other users. */
function AdminOnly({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  return user?.is_staff ? <>{children}</> : <Navigate to="/start" replace />;
}
const admin = (el: React.ReactNode) => guard(<AdminOnly>{el}</AdminOnly>);

const guard = (el: React.ReactNode) => (
  <RequireAuth>
    <Suspense fallback={<div className="p-10 text-center text-sm text-muted">Loading...</div>}>{el}</Suspense>
  </RequireAuth>
);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/start" element={guard(<StartPage />)} />
          <Route path="/new" element={guard(<NewCallPage />)} />
          <Route path="/join/:code" element={guard(<JoinPage />)} />
          <Route path="/call/:code" element={guard(<CallPage />)} />
          <Route path="/call/:code/summary" element={guard(<SummaryPage />)} />
          <Route path="/settings" element={guard(<SettingsPage />)} />
          <Route path="/translate" element={guard(<TranslatePage />)} />
          <Route path="/meetings" element={guard(<MeetingsPage />)} />
          <Route path="/meetings/new" element={guard(<NewMeetingPage />)} />
          <Route path="/meetings/:id" element={guard(<MeetingDetailPage />)} />
          <Route path="/meetings/:id/print" element={guard(<MeetingPrintPage />)} />
          <Route path="/admin" element={admin(<AdminDashboardPage />)} />
          <Route path="/admin/users" element={admin(<AdminUsersPage />)} />
          <Route path="/admin/plans" element={admin(<AdminPlansPage />)} />
          <Route path="/admin/keys" element={admin(<AdminKeysPage />)} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
