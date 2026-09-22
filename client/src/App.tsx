import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import type { Role } from '@shared/enums';
import { useAuth } from './auth/AuthContext';
import { AppShell } from './components/layout/AppShell';
import { BrandingProvider } from './components/layout/BrandingProvider';
import { Spinner } from './components/ui/Feedback';
import { ApprovalsPage } from './pages/approvals/ApprovalsPage';
import { AuditLogPage } from './pages/audit/AuditLogPage';
import { CampaignDetailPage } from './pages/campaigns/CampaignDetailPage';
import { CampaignsPage } from './pages/campaigns/CampaignsPage';
import { ClientDetailPage } from './pages/clients/ClientDetailPage';
import { CalendarPage } from './pages/calendar/CalendarPage';
import { ClientsPage } from './pages/clients/ClientsPage';
import { ContentPage } from './pages/content/ContentPage';
import { ContractsPage } from './pages/contracts/ContractsPage';
import { DashboardPage } from './pages/dashboard/DashboardPage';
import { DeliverableReviewPage } from './pages/deliverables/DeliverableReviewPage';
import { DeliverablesPage } from './pages/deliverables/DeliverablesPage';
import { FilesPage } from './pages/files/FilesPage';
import { InvoicesPage } from './pages/invoices/InvoicesPage';
import { LoginPage } from './pages/LoginPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { NotificationsPage } from './pages/NotificationsPage';
import { OnboardingPage } from './pages/onboarding/OnboardingPage';
import { ProjectDetailPage } from './pages/projects/ProjectDetailPage';
import { ProjectsPage } from './pages/projects/ProjectsPage';
import { ReportPrintPage } from './pages/reports/ReportPrintPage';
import { ReportsPage } from './pages/reports/ReportsPage';
import { RequestDetailPage } from './pages/requests/RequestDetailPage';
import { RequestsPage } from './pages/requests/RequestsPage';
import { SearchPage } from './pages/search/SearchPage';
import { SettingsPage } from './pages/SettingsPage';
import { TasksPage } from './pages/tasks/TasksPage';
import { TimePage } from './pages/time/TimePage';
import { WorkloadPage } from './pages/workload/WorkloadPage';
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

/** Route-level permission gate for staff (CLIENT users are always sent home). UI only - the API enforces the same rule. */
function Needs({ perm, children }: { perm: string; children: React.ReactNode }) {
  const { user, can } = useAuth();
  if (!user || user.role === 'CLIENT' || !can(perm)) return <Navigate to="/" replace />;
  return <>{children}</>;
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
    <BrandingProvider>
    <Routes>
      <Route path="/login" element={loading ? <FullScreenSpinner /> : user ? <Navigate to="/" replace /> : <LoginPage />} />
      <Route element={<RequireAuth />}>
        <Route index element={<DashboardPage />} />
        <Route path="clients" element={<Needs perm="clients.view"><ClientsPage /></Needs>} />
        <Route path="clients/:id" element={<Needs perm="clients.view"><ClientDetailPage /></Needs>} />
        <Route path="onboarding" element={<Needs perm="clients.view"><OnboardingPage /></Needs>} />
        <Route path="projects" element={<ProjectsPage />} />
        <Route path="projects/:id" element={<ProjectDetailPage />} />
        <Route path="tasks" element={<Needs perm="tasks.view"><TasksPage /></Needs>} />
        <Route path="time" element={<Needs perm="time.track"><TimePage /></Needs>} />
        <Route path="workload" element={<Needs perm="workload.view"><WorkloadPage /></Needs>} />
        <Route path="content" element={<ContentPage />} />
        <Route path="calendar" element={<CalendarPage />} />
        <Route path="contracts" element={<ContractsPage />} />
        <Route path="invoices" element={<InvoicesPage />} />
        <Route path="search" element={<SearchPage />} />
        <Route path="reports/print" element={<ReportPrintPage />} />
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
    </BrandingProvider>
  );
}
