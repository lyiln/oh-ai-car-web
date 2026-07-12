import { useEffect, useState } from 'react';
import { Car, FileText, MapPinned, ScanLine, ShieldCheck } from 'lucide-react';
import { isEmailJsConfigured, sendLoginPasscode } from '../services/emailService.js';
import { PlatformClient, type PlatformUser } from '../services/platformClient.js';

type LoginTab = 'password' | 'otp';
const client = new PlatformClient();

const FEATURES = [
  { icon: MapPinned, title: '自主巡检', desc: '智能规划路径，全天候无人值守自动执行巡检任务' },
  { icon: ScanLine, title: '车牌识别', desc: '毫秒级 AI 识别，支持新能源、军牌等多类型车牌' },
  { icon: FileText, title: '数据报告', desc: '结构化报告一键导出，精准呈现小区停车管理数据' },
] as const;

export function LoginPage({ onLogin }: { onLogin: (user: PlatformUser) => void }) {
  const [tab, setTab] = useState<LoginTab>('password');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [passcode, setPasscode] = useState('');
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setTimeout(() => setCooldown((value) => value - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  const switchTab = (next: LoginTab) => {
    setTab(next);
    setError('');
  };

  const submitPassword = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      setBusy(true);
      setError('');
      onLogin((await client.login(username, password)).user);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '登录失败');
    } finally {
      setBusy(false);
    }
  };

  const requestCode = async () => {
    try {
      setBusy(true);
      setError('');
      if (!username.trim()) throw new Error('请输入用户名');
      if (!isEmailJsConfigured()) throw new Error('邮件服务未配置');
      const result = await client.requestOtp(username.trim());
      if (result.passcode && result.deliveryEmail) {
        await sendLoginPasscode(result.deliveryEmail, result.passcode, result.time);
      }
      setCooldown(60);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '获取验证码失败');
    } finally {
      setBusy(false);
    }
  };

  const submitOtp = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      setBusy(true);
      setError('');
      onLogin((await client.verifyOtp(username.trim(), passcode)).user);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '登录失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="login-shell">
      <section className="login-brand">
        <div className="login-brand-inner">
          <div className="login-brand-mark">
            <span className="login-logo" aria-hidden="true"><Car size={28} strokeWidth={2.2} /></span>
            <p className="login-product-en">Vehicle Patrol System</p>
          </div>
          <h1>巡牌通 · PatrolPlate</h1>
          <p className="login-brand-tagline">智能巡检 · 车牌识别 · 任务调度 · 报告管理</p>
          <div className="login-feature-grid">
            {FEATURES.map(({ icon: Icon, title, desc }) => (
              <article key={title} className="login-feature-card">
                <span className="login-feature-icon" aria-hidden="true"><Icon size={18} /></span>
                <div>
                  <h3>{title}</h3>
                  <p>{desc}</p>
                </div>
              </article>
            ))}
          </div>
          <p className="login-status">
            <ShieldCheck size={16} aria-hidden="true" />
            系统运行正常 · 当前在线设备 12 台
          </p>
        </div>
      </section>

      <section className="login-card-wrap">
        <section className="login-card">
          <header className="login-card-header">
            <h2>欢迎登录</h2>
            <p className="login-subtitle">请使用管理员账号登录系统</p>
          </header>

          <div className="login-tabs" role="tablist" aria-label="登录方式">
            <button type="button" role="tab" className={tab === 'password' ? 'login-tab-active' : undefined} aria-selected={tab === 'password'} onClick={() => switchTab('password')}>账号登录</button>
            <button type="button" role="tab" className={tab === 'otp' ? 'login-tab-active' : undefined} aria-selected={tab === 'otp'} onClick={() => switchTab('otp')}>邮箱登录</button>
          </div>

          {tab === 'password' ? (
            <form className="login-form" onSubmit={submitPassword}>
              <label>
                用户名
                <input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" placeholder="请输入用户名" required />
              </label>
              <label>
                密码
                <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete="current-password" placeholder="请输入密码" required />
              </label>
              <div className="login-form-meta">
                <label className="login-remember">
                  <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} />
                  <span>记住我</span>
                </label>
                <button type="button" className="login-forgot" title="请联系管理员重置密码">忘记密码？</button>
              </div>
              {error && <p className="error">{error}</p>}
              <button type="submit" className="login-submit" disabled={busy}>登 录</button>
            </form>
          ) : (
            <form className="login-form" onSubmit={submitOtp}>
              <label>
                用户名
                <input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" placeholder="请输入已绑定邮箱的账号" required />
              </label>
              <div className="otp-row">
                <label className="otp-field">
                  邮箱验证码
                  <input className="otp-input" value={passcode} onChange={(event) => setPasscode(event.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="6 位验证码" required />
                </label>
                <button type="button" className="login-otp-btn" disabled={busy || cooldown > 0 || !username.trim()} onClick={() => void requestCode()}>
                  {cooldown > 0 ? `${cooldown}s` : '获取验证码'}
                </button>
              </div>
              {error && <p className="error">{error}</p>}
              <button type="submit" className="login-submit" disabled={busy || passcode.length !== 6}>登 录</button>
            </form>
          )}

          <p className="login-legal">登录即表示同意《用户协议》和《隐私政策》</p>
          <p className="login-footer">© 2026 巡牌通 · PatrolPlate</p>
        </section>
      </section>
    </main>
  );
}
