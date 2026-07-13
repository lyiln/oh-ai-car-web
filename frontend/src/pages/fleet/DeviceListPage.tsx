import { useEffect, useMemo, useState } from 'react';
import { FormModal } from '../../components/layout/FormModal.js';
import { useAuth } from '../../contexts/AuthContext.js';
import { useSelectedDevice } from '../../contexts/SelectedDeviceContext.js';
import type { Device } from '../../services/api.js';
import * as deviceClient from '../../services/deviceClient.js';

const emptyForm = {
  name: '',
  code: '',
  host: '192.168.1.11',
  tcpPort: 6000,
  videoPort: 6500,
  bridgeUrl: '',
  description: '',
};

function statusClass(status?: string) {
  if (status === 'online') return 'tag tag-success';
  if (status === 'patrolling') return 'tag tag-info';
  if (status === 'fault') return 'tag tag-danger';
  return 'tag';
}

function statusLabel(status?: string) {
  if (status === 'online') return '在线';
  if (status === 'patrolling') return '巡逻中';
  if (status === 'fault') return '故障';
  return '离线';
}

function matchesQuery(device: Device, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [device.name, device.code, device.host, device.description ?? '']
    .some((value) => value.toLowerCase().includes(q));
}

export function DeviceListPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const { devices, selectedId, setSelectedId, refreshDevices, loading, error } = useSelectedDevice();
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [pageError, setPageError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    void refreshDevices(debouncedQuery || undefined);
  }, [debouncedQuery, refreshDevices]);

  useEffect(() => () => {
    void refreshDevices();
  }, [refreshDevices]);

  const filtered = useMemo(
    () => devices.filter((device) => matchesQuery(device, query)),
    [devices, query],
  );

  const closeDrawer = () => {
    setOpen(false);
    setEditId(null);
    setFormError('');
    setForm(emptyForm);
  };

  const openCreate = () => {
    setEditId(null);
    setForm(emptyForm);
    setFormError('');
    setOpen(true);
  };

  const openEdit = (device: Device) => {
    setEditId(device.id);
    setForm({
      name: device.name,
      code: device.code,
      host: device.host,
      tcpPort: device.tcpPort,
      videoPort: device.videoPort,
      bridgeUrl: device.bridgeUrl ?? '',
      description: device.description ?? '',
    });
    setFormError('');
    setOpen(true);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!isAdmin) {
      setFormError('需要管理员权限');
      return;
    }
    setBusy(true);
    setFormError('');
    setPageError('');
    try {
      if (editId) {
        await deviceClient.updateDevice(editId, {
          name: form.name,
          host: form.host,
          tcpPort: Number(form.tcpPort) || 6000,
          videoPort: Number(form.videoPort) || 6500,
          bridgeUrl: form.bridgeUrl,
          description: form.description,
        });
        setNotice('设备已更新');
      } else {
        const device = await deviceClient.createDevice({
          ...form,
          tcpPort: Number(form.tcpPort) || 6000,
          videoPort: Number(form.videoPort) || 6500,
        });
        setSelectedId(device.id);
        setNotice('设备已添加');
      }
      await refreshDevices(debouncedQuery || undefined);
      closeDrawer();
    } catch (reason) {
      setFormError(reason instanceof Error ? reason.message : '保存失败');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    if (!isAdmin) {
      setPageError('需要管理员权限才能删除设备');
      return;
    }
    if (!window.confirm('确认删除该设备？')) return;
    setPageError('');
    setNotice('');
    try {
      await deviceClient.deleteDevice(id);
      if (selectedId === id) setSelectedId(null);
      await refreshDevices(debouncedQuery || undefined);
      setNotice('设备已删除');
    } catch (reason) {
      setPageError(reason instanceof Error ? reason.message : '删除失败');
    }
  };

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>设备管理</h1>
          <p>管理巡检小车 iCar 设备</p>
        </div>
        {isAdmin && (
          <button type="button" className="primary" onClick={openCreate}>新增设备</button>
        )}
      </header>

      <section className="panel filter-row">
        <label>
          模糊搜索
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="设备名称 / 编号 / IP"
          />
        </label>
      </section>

      {notice && <p className="notice">{notice}</p>}
      {(error || pageError) && <p className="error">{error || pageError}</p>}

      {loading ? (
        <div className="empty-state">加载中…</div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <p>{query.trim() ? '未找到匹配设备' : '暂无设备，请先添加巡检小车'}</p>
          {isAdmin && !query.trim() && (
            <button type="button" className="primary" onClick={openCreate}>新增设备</button>
          )}
        </div>
      ) : (
        <section className="panel">
          <table>
            <thead>
              <tr>
                <th>设备名称</th>
                <th>编号</th>
                <th>IP</th>
                <th>TCP</th>
                <th>状态</th>
                <th>最近巡逻</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((device) => (
                <tr key={device.id} className={selectedId === device.id ? 'row-active' : undefined}>
                  <td>{device.name}</td>
                  <td>{device.code}</td>
                  <td>{device.host}</td>
                  <td>{device.tcpPort}</td>
                  <td><span className={statusClass(device.status)}>{statusLabel(device.status)}</span></td>
                  <td>{device.lastPatrolAt ? new Date(device.lastPatrolAt).toLocaleString() : '-'}</td>
                  <td>
                    <div className="button-row">
                      <button
                        type="button"
                        className={selectedId === device.id ? 'primary' : 'secondary'}
                        onClick={() => setSelectedId(device.id)}
                      >
                        {selectedId === device.id ? '当前设备' : '设为当前'}
                      </button>
                      {isAdmin && (
                        <>
                          <button type="button" className="secondary" onClick={() => openEdit(device)}>编辑</button>
                          <button type="button" className="danger" onClick={() => void remove(device.id)}>删除</button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <FormModal open={open} title={editId ? '编辑设备' : '新增设备'} onClose={closeDrawer}>
        <form className="stack-form" onSubmit={(event) => void submit(event)}>
          <label>设备名称*<input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <label>
            设备编号*
            <input
              required
              value={form.code}
              disabled={Boolean(editId)}
              onChange={(e) => setForm({ ...form, code: e.target.value })}
            />
          </label>
          <label>IP 地址*<input required value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} /></label>
          <label>TCP 端口<input type="number" value={form.tcpPort} onChange={(e) => setForm({ ...form, tcpPort: Number(e.target.value) })} /></label>
          <label>视频端口<input type="number" value={form.videoPort} onChange={(e) => setForm({ ...form, videoPort: Number(e.target.value) })} /></label>
          <label>Bridge 地址<input value={form.bridgeUrl} onChange={(e) => setForm({ ...form, bridgeUrl: e.target.value })} /></label>
          <label>备注<input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
          {formError && <p className="error">{formError}</p>}
          <button type="submit" className="primary" disabled={busy}>{busy ? '保存中…' : '保存'}</button>
        </form>
      </FormModal>
    </div>
  );
}
