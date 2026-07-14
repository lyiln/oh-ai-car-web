import { useEffect, useState } from 'react';
import { FormModal } from '../../components/layout/FormModal.js';
import { useAuth } from '../../contexts/AuthContext.js';
import type { WhitelistEntry } from '../../services/api.js';
import * as opsClient from '../../services/opsClient.js';

type WhitelistForm = {
  plate: string;
  owner: string;
  building: string;
  parkingSpot: string;
  wxUid: string;
  vehicleType: 'private' | 'visitor';
  validUntil: string;
};

const empty: WhitelistForm = {
  plate: '',
  owner: '',
  building: '',
  parkingSpot: '',
  wxUid: '',
  vehicleType: 'private',
  validUntil: '',
};

function vehicleTypeLabel(value?: string | null) {
  if (value === 'private') return '私家车';
  if (value === 'visitor') return '访客';
  return value || '-';
}

function displayText(value?: string | null) {
  const text = value?.trim();
  return text ? text : '-';
}

function toDateInput(value?: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

function entryToForm(entry: WhitelistEntry): WhitelistForm {
  return {
    plate: entry.plate,
    owner: entry.owner ?? '',
    building: entry.building ?? '',
    parkingSpot: entry.parkingSpot ?? '',
    wxUid: entry.wxUid ?? '',
    vehicleType: entry.vehicleType === 'visitor' ? 'visitor' : 'private',
    validUntil: toDateInput(entry.validUntil),
  };
}

export function WhitelistPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [entries, setEntries] = useState<WhitelistEntry[]>([]);
  const [form, setForm] = useState<WhitelistForm>(empty);
  const [csv, setCsv] = useState('');
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [query]);

  const refresh = async (q = debouncedQuery) => {
    setEntries(await opsClient.whitelist(q || undefined));
  };

  useEffect(() => {
    void refresh(debouncedQuery).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : '加载失败'));
  }, [debouncedQuery]);

  const closeFormDrawer = () => {
    setAddOpen(false);
    setEditId(null);
    setForm(empty);
    setError('');
  };

  const closeImportDrawer = () => {
    setImportOpen(false);
    setError('');
  };

  const openEdit = (entry: WhitelistEntry) => {
    setEditId(entry.id);
    setForm(entryToForm(entry));
    setAddOpen(false);
    setError('');
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      const payload = {
        plate: form.plate.trim(),
        owner: form.owner || null,
        building: form.building || null,
        parkingSpot: form.parkingSpot || null,
        wxUid: form.wxUid || null,
        vehicleType: form.vehicleType,
        validUntil: form.validUntil || null,
      };
      if (editId) {
        await opsClient.updateWhitelist(editId, payload);
        setMessage('白名单已更新');
      } else {
        await opsClient.addWhitelist(payload);
        setMessage('已添加白名单');
      }
      setForm(empty);
      setAddOpen(false);
      setEditId(null);
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '保存失败');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (entry: WhitelistEntry) => {
    if (!window.confirm(`确认删除车牌 ${entry.plate} 的白名单？`)) return;
    setError('');
    try {
      await opsClient.deleteWhitelist(entry.id);
      setMessage(`已删除 ${entry.plate}`);
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '删除失败');
    }
  };

  const importCsv = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      const result = await opsClient.importWhitelist(csv);
      setMessage(`导入完成：成功 ${result.imported}，失败 ${result.failed}`);
      setCsv('');
      setImportOpen(false);
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '导入失败');
    } finally {
      setBusy(false);
    }
  };

  const formOpen = addOpen || Boolean(editId);

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>白名单管理</h1>
          <p>小区全局白名单，所有巡检车共用；支持搜索、单条增删改与 CSV 批量导入</p>
        </div>
        {isAdmin && (
          <div className="button-row">
            <button type="button" className="primary" onClick={() => { setEditId(null); setForm(empty); setAddOpen(true); setError(''); }}>新增白名单</button>
            <button type="button" className="secondary" onClick={() => setImportOpen(true)}>批量导入</button>
          </div>
        )}
      </header>
      {message && <p className="notice">{message}</p>}
      {error && !formOpen && !importOpen && <p className="error">{error}</p>}

      <section className="panel filter-row">
        <label>
          模糊搜索
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="车牌 / 车主 / 楼栋 / 车位 / WxUID"
          />
        </label>
      </section>

      <section className="panel">
        <h2>白名单列表</h2>
        {entries.length === 0 ? (
          <div className="empty-state">
            <p>{debouncedQuery ? '未找到匹配的白名单' : '暂无白名单'}</p>
            {isAdmin && !debouncedQuery && (
              <button type="button" className="primary" onClick={() => { setAddOpen(true); setEditId(null); setForm(empty); }}>新增白名单</button>
            )}
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>车牌</th>
                <th>车主</th>
                <th>楼栋</th>
                <th>车位</th>
                <th>WxUID</th>
                <th>类型</th>
                <th>有效期</th>
                {isAdmin && <th>操作</th>}
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <td>{entry.plate}</td>
                  <td>{displayText(entry.owner)}</td>
                  <td>{displayText(entry.building)}</td>
                  <td>{displayText(entry.parkingSpot)}</td>
                  <td>{displayText(entry.wxUid)}</td>
                  <td>{vehicleTypeLabel(entry.vehicleType)}</td>
                  <td>{entry.validUntil ? new Date(entry.validUntil).toLocaleDateString() : '长期'}</td>
                  {isAdmin && (
                    <td>
                      <div className="button-row">
                        <button type="button" className="secondary" onClick={() => openEdit(entry)}>编辑</button>
                        <button type="button" className="danger" onClick={() => void remove(entry)}>删除</button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <FormModal open={formOpen} title={editId ? '编辑白名单' : '新增白名单'} onClose={closeFormDrawer}>
        <form className="stack-form" onSubmit={(event) => void save(event)}>
          <label>车牌*<input required value={form.plate} onChange={(e) => setForm({ ...form, plate: e.target.value })} /></label>
          <label>车主<input value={form.owner} onChange={(e) => setForm({ ...form, owner: e.target.value })} /></label>
          <label>楼栋<input value={form.building} onChange={(e) => setForm({ ...form, building: e.target.value })} /></label>
          <label>车位<input value={form.parkingSpot} onChange={(e) => setForm({ ...form, parkingSpot: e.target.value })} /></label>
          <label>WxPusher UID<input value={form.wxUid} onChange={(e) => setForm({ ...form, wxUid: e.target.value })} placeholder="关注应用后获得的 UID_xxx，可选" /></label>
          <label>
            车辆类型
            <select value={form.vehicleType} onChange={(e) => setForm({ ...form, vehicleType: e.target.value as WhitelistForm['vehicleType'] })}>
              <option value="private">私家车</option>
              <option value="visitor">访客</option>
            </select>
          </label>
          <label>有效期<input type="date" value={form.validUntil} onChange={(e) => setForm({ ...form, validUntil: e.target.value })} /></label>
          {error && <p className="error">{error}</p>}
          <button type="submit" className="primary" disabled={busy}>{editId ? '保存修改' : '保存'}</button>
        </form>
      </FormModal>

      <FormModal open={importOpen} title="批量导入白名单" onClose={closeImportDrawer}>
        <form className="stack-form" onSubmit={(event) => void importCsv(event)}>
          <label className="stack-form">
            粘贴 CSV（plate,owner,building,parkingSpot,wxUid,vehicleType,validUntil）
            <textarea rows={10} value={csv} onChange={(e) => setCsv(e.target.value)} required />
          </label>
          {error && <p className="error">{error}</p>}
          <button type="submit" className="primary" disabled={!csv.trim() || busy}>开始导入</button>
        </form>
      </FormModal>
    </div>
  );
}
