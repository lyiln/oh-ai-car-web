import { Navigate, useNavigate } from 'react-router-dom';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { AppShell } from './components/layout/AppShell.js';
import { useAuth } from './contexts/AuthContext.js';
import { SelectedDeviceProvider } from './contexts/SelectedDeviceContext.js';
import { LoginPage } from './app/LoginPage.js';
import { ClassicConsole } from './app/ClassicConsole.js';
import { DashboardPage } from './pages/dashboard/DashboardPage.js';
import { DeviceListPage } from './pages/fleet/DeviceListPage.js';
import { ConsolePage } from './pages/console/ConsolePage.js';
import { PatrolTaskPage } from './pages/patrol/PatrolTaskPage.js';
import { PatrolRecordsPage } from './pages/patrol/PatrolRecordsPage.js';
import { PatrolRecordDetailPage } from './pages/patrol/PatrolRecordDetailPage.js';
import { MapPage } from './pages/map/MapPage.js';
import { ViolationsPage } from './pages/violations/ViolationsPage.js';
import { ReviewQueuePage } from './pages/reviews/ReviewQueuePage.js';
import { WhitelistPage } from './pages/whitelist/WhitelistPage.js';
import { ReportsPage } from './pages/reports/ReportsPage.js';
import { SettingsPage } from './pages/settings/SettingsPage.js';

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="empty-state">正在验证登录…</div>;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function LoginRoute() {
  const { user, setUser, loading } = useAuth();
  const navigate = useNavigate();
  if (loading) return <div className="empty-state">加载中…</div>;
  if (user) return <Navigate to="/dashboard" replace />;
  return (
    <LoginPage
      onLogin={(next) => {
        setUser(next);
        navigate('/dashboard', { replace: true });
      }}
    />
  );
}

export const router = createBrowserRouter([
  { path: '/login', element: <LoginRoute /> },
  {
    path: '/',
    element: (
      <RequireAuth>
        <SelectedDeviceProvider>
          <AppShell />
        </SelectedDeviceProvider>
      </RequireAuth>
    ),
    children: [
      { index: true, element: <Navigate to="/dashboard" replace /> },
      { path: 'dashboard', element: <DashboardPage /> },
      { path: 'fleet', element: <DeviceListPage /> },
      { path: 'console', element: <ConsolePage /> },
      { path: 'patrol/tasks', element: <PatrolTaskPage /> },
      { path: 'patrol/records', element: <PatrolRecordsPage /> },
      { path: 'patrol/records/:id', element: <PatrolRecordDetailPage /> },
      { path: 'map', element: <MapPage /> },
      { path: 'violations', element: <ViolationsPage /> },
      { path: 'reviews', element: <ReviewQueuePage /> },
      { path: 'whitelist', element: <WhitelistPage /> },
      { path: 'reports', element: <ReportsPage /> },
      { path: 'settings', element: <SettingsPage /> },
    ],
  },
  { path: '/connect', element: <ClassicConsole /> },
  { path: '/remote', element: <ClassicConsole /> },
  { path: '*', element: <Navigate to="/dashboard" replace /> },
]);

export function AppRouter() {
  return <RouterProvider router={router} />;
}
