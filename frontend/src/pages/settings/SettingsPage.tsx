import { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext.js';
import { PlatformClient } from '../../services/platformClient.js';
import * as opsClient from '../../services/opsClient.js';

type Tab = 'routes' | 'zones' | 'alerts' | 'connection' | 'account';
const client = new PlatformClient();

export function SettingsPage() {
  const { user, setUser } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [tab, setTab] = useState<Tab>('routes');
  const [settings, setSettings] = useState<Record<string, unknown>>({});
  const [jsonText, setJsonText] = useState('{}');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [password, setPassword] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);

  useEffect(() => {
    void opsClient.getSettings()
      .then((next) => {
        setSettings(next);
        setJsonText(JSON.stringify(next, null, 2));
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : '加载失败'));
  }, []);

  useEffect(() => {
    setDisplayName(user?.displayName ?? '');
    setEmail(user?.email ?? '');
  }, [user?.displayName, user?.email]);

  useEffect(() => {
    if (tab === 'account' && !isAdmin) setTab('routes');
  }, [tab, isAdmin]);

  const save = async () => {
    setError('');
    try {
      const parsed = JSON.parse(jsonText) as Record<string, unknown>;
      await opsClient.putSettings(parsed);
      setSettings(parsed);
      setMessage('设置已保存');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '保存失败');
    }
  };

  const patchField = (key: string, value: unknown) => {
    const next = { ...settings, [key]: value };
    setSettings(next);
    setJsonText(JSON.stringify(next, null, 2));
  };

  const saveProfile = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setMessage('');
    try {
      setSavingProfile(true);
      const payload: {
        displayName?: string;
        email?: string | null;
        password?: string;
        currentPassword?: string;
      } = {
        displayName: displayName.trim(),
        email: email.trim() ? email.trim() : null,
      };
      if (password) {
        payload.password = password;
        payload.currentPassword = currentPassword;
      }
      const result = await client.updateProfile(payload);
      setUser(result.user);
      setPassword('');
      setCurrentPassword('');
      setMessage('账号信息已保存');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '保存账号信息失败');
    } finally {
      setSavingProfile(false);
    }
  };

  const tabs = ([
    ['routes', '路线与航点'],
    ['zones', '禁停区管理'],
    ['alerts', '告警规则'],
    ['connection', '连接配置'],
    ...(isAdmin ? [['account', '账号信息'] as const] : []),
  ] as const);

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>系统设置</h1>
          <p>路线、禁停区、告警与连接参数{isAdmin ? '，以及管理员账号信息' : ''}</p>
        </div>
      </header>
      {message && <p className="notice">{message}</p>}
      {error && <p className="error">{error}</p>}
      <div className="login-tabs page-tabs" role="tablist">
        {tabs.map(([key, label]) => (
          <button key={key} type="button" className={tab === key ? 'login-tab-active' : undefined} onClick={() => setTab(key)}>{label}</button>
        ))}
      </div>
      <section className="panel mt-12">
        {tab === 'routes' && (
          <label className="stack-form">
            patrol_waypoints.yaml
            <textarea
              rows={12}
              value={String(settings.waypointsYaml ?? '')}
              onChange={(e) => patchField('waypointsYaml', e.target.value)}
              placeholder="粘贴或编辑航点 YAML"
            />
          </label>
        )}
        {tab === 'zones' && (
          <p className="muted">禁停区请在「全局地图」页绘制与维护。当前设置 JSON 可同步存储区域元数据。</p>
        )}
        {tab === 'alerts' && (
          <div className="stack-form">
            <label>
              置信度阈值
              <input
                type="number"
                step="0.01"
                min={0}
                max={1}
                value={Number(settings.alertConfidence ?? 0.7)}
                onChange={(e) => patchField('alertConfidence', Number(e.target.value))}
              />
            </label>
            <label>
              去重时间窗口（秒）
              <input
                type="number"
                value={Number(settings.dedupeWindowSec ?? 120)}
                onChange={(e) => patchField('dedupeWindowSec', Number(e.target.value))}
              />
            </label>
          </div>
        )}
        {tab === 'connection' && (
          <div className="stack-form">
            <label>
              默认 Bridge
              <input
                value={String(settings.bridgeDefault ?? '')}
                onChange={(e) => patchField('bridgeDefault', e.target.value)}
              />
            </label>
            <label>
              连接超时（ms）
              <input
                type="number"
                value={Number(settings.connectTimeoutMs ?? 5000)}
                onChange={(e) => patchField('connectTimeoutMs', Number(e.target.value))}
              />
            </label>
          </div>
        )}
        {tab === 'account' && isAdmin && (
          <form className="stack-form" onSubmit={(event) => void saveProfile(event)}>
            <label>
              用户名
              <input value={user?.username ?? ''} readOnly disabled />
            </label>
            <label>
              显示名
              <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} required placeholder="显示名称" />
            </label>
            <label>
              邮箱
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="绑定后可用于验证码登录"
              />
            </label>
            <p className="muted">修改邮箱后，验证码登录将发往新地址。留空表示清除绑定邮箱。</p>
            <label>
              当前密码
              <input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                autoComplete="current-password"
                placeholder={password ? '修改密码时必填' : '仅修改密码时需要'}
              />
            </label>
            <label>
              新密码
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                placeholder="留空则不修改密码"
              />
            </label>
            <div className="button-row">
              <button type="submit" className="primary" disabled={savingProfile}>保存账号信息</button>
            </div>
          </form>
        )}
        {tab !== 'account' && (
          <>
            <h3 className="mt-20">原始 JSON</h3>
            <textarea className="settings-json" rows={10} value={jsonText} onChange={(e) => setJsonText(e.target.value)} />
            <div className="button-row mt-12">
              <button type="button" className="primary" onClick={() => void save()}>保存设置</button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
