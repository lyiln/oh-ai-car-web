import { Car } from 'lucide-react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { AdvisorPanel } from '../ai/AdvisorPanel.js';
import { useAuth } from '../../contexts/AuthContext.js';
import { useSelectedDevice } from '../../contexts/SelectedDeviceContext.js';
import { KeepAliveOutlet } from './KeepAliveOutlet.js';

const NAV = [
  { to: '/dashboard', label: '工作台' },
  { to: '/fleet', label: '设备管理' },
  { to: '/console', label: '控制台' },
  { to: '/patrol/tasks', label: '巡检任务' },
  { to: '/patrol/records', label: '巡逻记录' },
  { to: '/map', label: '全局地图' },
  { to: '/violations', label: '违规车辆' },
  { to: '/responses', label: '微信通知' },
  { to: '/reviews', label: '待人工审核' },
  { to: '/whitelist', label: '白名单管理' },
  { to: '/reports', label: '报告中心' },
  { to: '/settings', label: '系统设置' },
  { to: '/admin/users', label: '用户管理' },
  { to: '/admin/audit', label: '审计日志' },
] as const;

function labelForPath(pathname: string): string {
  const exact = NAV.find((item) => item.to === pathname);
  if (exact) return exact.label;
  if (pathname.startsWith('/patrol/records/')) return '巡逻记录详情';
  return '巡牌通';
}

export function AppShell() {
  const { user, logout } = useAuth();
  const { selectedDevice } = useSelectedDevice();
  const location = useLocation();
  const navigate = useNavigate();
  const online = selectedDevice?.status === 'online' || selectedDevice?.status === 'patrolling';

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className="shell">
      <aside className="shell-sidebar">
        <div className="shell-brand">
          <span className="shell-brand-mark" aria-hidden="true"><Car size={22} strokeWidth={2.2} /></span>
          <div className="shell-brand-copy">
            <strong>巡牌通</strong>
            <span>PatrolPlate</span>
          </div>
        </div>
        <nav className="shell-nav" aria-label="主导航">
          {NAV.filter((item) => !['/whitelist', '/admin/users', '/admin/audit'].includes(item.to) || user?.role === 'admin').map((item) => (
            <NavLink key={item.to} to={item.to} className={({ isActive }) => (isActive ? 'active' : undefined)}>
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <div className="shell-main">
        <header className="shell-topbar">
          <div className="shell-breadcrumb">{labelForPath(location.pathname)}</div>
          <div className="shell-topbar-meta">
            <span className="shell-device-chip">{selectedDevice ? selectedDevice.name : '未选择设备'}</span>
            <span className="shell-conn-chip">{online ? '设备在线' : '等待连接'}</span>
            <span className="shell-user">{user?.displayName ?? '用户'}</span>
            <button type="button" className="secondary" onClick={() => void handleLogout()}>退出</button>
          </div>
        </header>
        <div className="shell-content">
          <KeepAliveOutlet />
        </div>
        <footer className="shell-device-bar">
          <span className={`status-dot ${online ? 'online' : ''}`} aria-hidden="true" />
          <span>{selectedDevice ? `当前小车：${selectedDevice.name}` : '当前小车：未选择'}</span>
          <span className="shell-device-bar-muted">{online ? '在线' : '离线'}</span>
        </footer>
      </div>
      <AdvisorPanel />
    </div>
  );
}
