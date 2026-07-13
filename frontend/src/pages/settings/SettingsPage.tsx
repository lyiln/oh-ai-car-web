import { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext.js';
import { useSelectedDevice } from '../../contexts/SelectedDeviceContext.js';
import { PlatformClient } from '../../services/platformClient.js';
import * as opsClient from '../../services/opsClient.js';
import * as patrolClient from '../../services/patrolClient.js';

type Tab = 'routes' | 'alerts' | 'account';
const client = new PlatformClient();
const routeTemplate = `waypoints:
  - name: 起点
    x: 0
    y: 0
    yaw: 0
    dwellSeconds: 8
  - name: 巡检点
    x: 1
    y: 1
    yaw: 0
    dwellSeconds: 8
  - name: 终点
    x: 2
    y: 2
    yaw: 0
    dwellSeconds: 8`;

export function SettingsPage() {
  const { user, setUser } = useAuth();
  const { devices, selectedId, setSelectedId } = useSelectedDevice();
  const isAdmin = user?.role === 'admin';
  const [tab, setTab] = useState<Tab>(isAdmin ? 'routes' : 'account');
  const [rules, setRules] = useState({ reviewConfidenceThreshold: 0.75, dedupeWindowSec: 1800 });
  const [routeName, setRouteName] = useState('');
  const [mapVersion, setMapVersion] = useState('');
  const [yaml, setYaml] = useState(routeTemplate);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void opsClient.getSettings().then((next) => setRules({
      reviewConfidenceThreshold: Number(next.reviewConfidenceThreshold ?? 0.75),
      dedupeWindowSec: Number(next.dedupeWindowSec ?? 1800),
    })).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : '加载失败'));
  }, []);
  useEffect(() => { setDisplayName(user?.displayName ?? ''); setEmail(user?.email ?? ''); }, [user?.displayName, user?.email]);
  useEffect(() => { if (!isAdmin && tab !== 'account') setTab('account'); }, [isAdmin, tab]);

  const saveRules = async () => {
    setBusy(true); setError(''); setMessage('');
    try { await opsClient.putSettings(rules); setMessage('识别规则已保存；新建巡检任务会使用此配置快照。'); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '保存失败'); }
    finally { setBusy(false); }
  };
  const importRoute = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError(''); setMessage('');
    try {
      if (!selectedId) throw new Error('请先选择设备');
      await patrolClient.importRoute(selectedId, { name: routeName, mapVersion, yaml });
      setRouteName(''); setMapVersion(''); setMessage('路线已导入，可在巡检任务页选择。');
    } catch (reason) { setError(reason instanceof Error ? reason.message : '路线导入失败'); }
    finally { setBusy(false); }
  };
  const saveProfile = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError(''); setMessage('');
    try {
      const payload: { displayName?: string; email?: string | null; password?: string; currentPassword?: string } = { displayName: displayName.trim(), email: email.trim() || null };
      if (password) { payload.password = password; payload.currentPassword = currentPassword; }
      const result = await client.updateProfile(payload); setUser(result.user); setPassword(''); setCurrentPassword(''); setMessage('账号信息已保存');
    } catch (reason) { setError(reason instanceof Error ? reason.message : '保存账号信息失败'); }
    finally { setBusy(false); }
  };

  const tabs = [
    ...(isAdmin ? [['routes', '路线导入'] as const, ['alerts', '识别规则'] as const] : []),
    ['account', '账号信息'] as const,
  ];
  return <div className="page">
    <header className="page-header"><div><h1>系统设置</h1><p>{isAdmin ? '管理路线、识别规则和个人账号' : '管理个人账号信息'}</p></div></header>
    {message && <p className="notice">{message}</p>}{error && <p className="error">{error}</p>}
    <div className="login-tabs page-tabs" role="tablist">{tabs.map(([key, label]) => <button key={key} type="button" className={tab === key ? 'login-tab-active' : undefined} onClick={() => setTab(key)}>{label}</button>)}</div>
    <section className="panel mt-12">
      {tab === 'routes' && isAdmin && <form className="stack-form" onSubmit={(event) => void importRoute(event)}>
        <label>目标设备<select required value={selectedId ?? ''} onChange={(event) => setSelectedId(event.target.value || null)}><option value="">请选择设备</option>{devices.map((device) => <option key={device.id} value={device.id}>{device.name}</option>)}</select></label>
        <label>路线名称<input required value={routeName} onChange={(event) => setRouteName(event.target.value)} /></label>
        <label>地图版本<input required value={mapVersion} onChange={(event) => setMapVersion(event.target.value)} placeholder="community-map-v1" /></label>
        <label>路线 YAML<textarea rows={16} value={yaml} onChange={(event) => setYaml(event.target.value)} /></label>
        <p className="muted">必须有 3–8 个航点；每个航点包含 name、x、y、yaw、dwellSeconds（8–10 秒），可选 noParkingRoi。</p>
        <button type="submit" className="primary" disabled={busy}>导入路线</button>
      </form>}
      {tab === 'alerts' && isAdmin && <div className="stack-form">
        <label>人工审核置信度阈值<input type="number" step="0.01" min={0} max={1} value={rules.reviewConfidenceThreshold} onChange={(event) => setRules({ ...rules, reviewConfidenceThreshold: Number(event.target.value) })} /></label>
        <label>去重时间窗口（秒）<input type="number" min={60} max={86400} value={rules.dedupeWindowSec} onChange={(event) => setRules({ ...rules, dedupeWindowSec: Number(event.target.value) })} /></label>
        <p className="muted">规则在创建巡检任务时写入任务快照，不会改变正在执行任务的判定标准。</p>
        <button type="button" className="primary" disabled={busy} onClick={() => void saveRules()}>保存规则</button>
      </div>}
      {tab === 'account' && <form className="stack-form" onSubmit={(event) => void saveProfile(event)}>
        <label>用户名<input value={user?.username ?? ''} readOnly disabled /></label>
        <label>显示名<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} required /></label>
        <label>邮箱<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="绑定后可用于验证码登录" /></label>
        <label>当前密码<input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} autoComplete="current-password" placeholder={password ? '修改密码时必填' : '仅修改密码时需要'} /></label>
        <label>新密码<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" placeholder="留空则不修改密码" /></label>
        <button type="submit" className="primary" disabled={busy}>保存账号信息</button>
      </form>}
    </section>
  </div>;
}
