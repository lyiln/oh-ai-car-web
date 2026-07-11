import { useState } from 'react';
import { FormModal } from '../../components/layout/FormModal.js';
import { useSelectedDevice } from '../../contexts/SelectedDeviceContext.js';
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

export function DeviceListPage() {
  const { devices, selectedId, setSelectedId, refreshDevices, loading, error } = useSelectedDevice();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');

  const closeDrawer = () => {
    setOpen(false);
    setFormError('');
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setFormError('');
    try {
      const device = await deviceClient.createDevice({
        ...form,
        tcpPort: Number(form.tcpPort) || 6000,
        videoPort: Number(form.videoPort) || 6500,
      });
      await refreshDevices();
      setSelectedId(device.id);
      setForm(emptyForm);
      setOpen(false);
    } catch (reason) {
      setFormError(reason instanceof Error ? reason.message : '添加失败');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm('确认删除该设备？')) return;
    try {
      await deviceClient.deleteDevice(id);
      if (selectedId === id) setSelectedId(null);
      await refreshDevices();
    } catch (reason) {
      window.alert(reason instanceof Error ? reason.message : '删除失败');
    }
  };

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>设备管理</h1>
          <p>管理巡检小车 iCar 设备</p>
        </div>
        <button type="button" className="primary" onClick={() => setOpen(true)}>新增设备</button>
      </header>
      {error && <p className="error">{error}</p>}
      {loading ? (
        <div className="empty-state">加载中…</div>
      ) : devices.length === 0 ? (
        <div className="empty-state">
          <p>暂无设备，请先添加巡检小车</p>
          <button type="button" className="primary" onClick={() => setOpen(true)}>新增设备</button>
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
              {devices.map((device) => (
                <tr key={device.id} className={selectedId === device.id ? 'row-active' : undefined}>
                  <td>{device.name}</td>
                  <td>{device.code}</td>
                  <td>{device.host}</td>
                  <td>{device.tcpPort}</td>
                  <td><span className={statusClass(device.status)}>{statusLabel(device.status)}</span></td>
                  <td>{device.lastPatrolAt ? new Date(device.lastPatrolAt).toLocaleString() : '-'}</td>
                  <td>
                    <div className="button-row">
                      <button type="button" className={selectedId === device.id ? 'primary' : 'secondary'} onClick={() => setSelectedId(device.id)}>
                        {selectedId === device.id ? '当前设备' : '设为当前'}
                      </button>
                      <button type="button" className="danger" onClick={() => void remove(device.id)}>删除</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <FormModal open={open} title="新增设备" onClose={closeDrawer}>
        <form className="stack-form" onSubmit={(event) => void submit(event)}>
          <label>设备名称*<input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <label>设备编号*<input required value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} /></label>
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
