import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import type { Role } from '@shared/enums';
import { useAuth } from './auth/AuthContext';
import { AppShell } from './components/layout/AppShell';
import { Spinner } from './components/ui/Feedback';
import { ApprovalsPage } from './pages/approvals/ApprovalsPage';
import { AuditLogPage } from './pages/audit/AuditLogPage';
import { CampaignDetailPage } from './pages/campaigns/CampaignDetailPage';
import { CampaignsPage } from './pages/campaigns/CampaignsPage';
import { ClientDetailPage } from './pages/clients/ClientDetailPage';
import { ClientsPage } from './pages/clients/ClientsPage';
import { DashboardPage } from './pages/dashboard/DashboardPage';
import { DeliverableReviewPage } from './pages/deliverables/DeliverableReviewPage';
import { DeliverablesPage } from './pages/deliverables/DeliverablesPage';
import { FilesPage } from './pages/files/FilesPage';
import { LoginPage } from './pages/LoginPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { NotificationsPage } from './pages/NotificationsPage';
import { ReportsPage } from './pages/reports/ReportsPage';
import { RequestDetailPage } from './pages/requests/RequestDetailPage';
import { RequestsPage } from './pages/requests/RequestsPage';
import { SettingsPage } from './pages/SettingsPage';
import { UsersPage } from './pages/users/UsersPage';

function FullScreenSpinner() {
  return <div className="flex min-h-dvh items-center justify-center"><Spinner className="size-7" /></div>;
}

/** Everything inside requires a session; unauthenticated visitors are sent to /login. */
function RequireAuth() {
  const { user, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <FullScreenSpinner />;
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname + loc.search }} />;
  return <AppShell />;
}

/** Route-level role gate (the API enforces the same rules - this only avoids dead-end pages). */
function Only({ roles, children }: { roles: Role[]; children: React.ReactNode }) {
  const { user } = useAuth();
  if (!user || !roles.includes(user.role)) return <Navigate to="/" replace />;
  return <>{children}</>;
}

export function App() {
  const { user, loading } = useAuth();
  return (
    <Routes>
      <Route path="/login" element={loading ? <FullScreenSpinner /> : user ? <Navigate to="/" replace /> : <LoginPage />} />
      <Route element={<RequireAuth />}>
        <Route index element={<DashboardPage />} />
        <Route path="clients" element={<Only roles={['ADMIN', 'TEAM']}><ClientsPage /></Only>} />
        <Route path="clients/:id" element={<Only roles={['ADMIN', 'TEAM']}><ClientDetailPage /></Only>} />
        <Route path="users" element={<Only roles={['ADMIN']}><UsersPage /></Only>} />
        <Route path="campaigns" element={<CampaignsPage />} />
        <Route path="campaigns/:id" element={<CampaignDetailPage />} />
        <Route path="deliverables" element={<DeliverablesPage />} />
        <Route path="deliverables/:id" element={<DeliverableReviewPage />} />
        <Route path="approvals" element={<ApprovalsPage />} />
        <Route path="requests" element={<RequestsPage />} />
        <Route path="requests/:id" element={<RequestDetailPage />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="files" element={<FilesPage />} />
        <Route path="notifications" element={<NotificationsPage />} />
        <Route path="audit-log" element={<Only roles={['ADMIN']}><AuditLogPage /></Only>} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
