import { useEffect, useState } from 'react';
import { PlatformClient, type PlatformUser } from '../../services/platformClient.js';

const client = new PlatformClient();
export function AdminUsersPage() {
  const [users, setUsers] = useState<PlatformUser[]>([]); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ username: '', displayName: '', password: '', role: 'operator', email: '' });
  const refresh = async () => { try { setUsers((await client.users()).users); } catch (reason) { setError(reason instanceof Error ? reason.message : '加载失败'); } };
  useEffect(() => { void refresh(); }, []);
  const create = async (event: React.FormEvent) => { event.preventDefault(); setBusy(true); setError(''); try { await client.createUser({ ...form, role: form.role as 'admin' | 'operator', email: form.email || undefined }); setForm({ username: '', displayName: '', password: '', role: 'operator', email: '' }); await refresh(); } catch (reason) { setError(reason instanceof Error ? reason.message : '创建失败'); } finally { setBusy(false); } };
  const toggle = async (entry: PlatformUser) => { setBusy(true); setError(''); try { await client.updateUser(entry.id, { active: !entry.active }); await refresh(); } catch (reason) { setError(reason instanceof Error ? reason.message : '更新失败'); } finally { setBusy(false); } };
  return <div className="page"><header className="page-header"><div><h1>用户管理</h1><p>创建账号并管理启用状态</p></div></header>{error && <p className="error">{error}</p>}
    <section className="panel"><form className="stack-form" onSubmit={(event) => void create(event)}><h2>新增用户</h2><label>用户名<input required value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} /></label><label>显示名<input required value={form.displayName} onChange={(event) => setForm({ ...form, displayName: event.target.value })} /></label><label>初始密码<input required type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} /></label><label>角色<select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value })}><option value="operator">操作员</option><option value="admin">管理员</option></select></label><label>邮箱<input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label><button className="primary" disabled={busy}>创建用户</button></form></section>
    <section className="panel mt-16"><h2>现有用户</h2><table><thead><tr><th>用户名</th><th>显示名</th><th>邮箱</th><th>角色</th><th>状态</th><th>操作</th></tr></thead><tbody>{users.map((entry) => <tr key={entry.id}><td>{entry.username}</td><td>{entry.displayName}</td><td>{entry.email || '-'}</td><td>{entry.role}</td><td>{entry.active ? '启用' : '停用'}</td><td><button type="button" className="secondary" disabled={busy} onClick={() => void toggle(entry)}>{entry.active ? '停用' : '启用'}</button></td></tr>)}</tbody></table></section></div>;
}
