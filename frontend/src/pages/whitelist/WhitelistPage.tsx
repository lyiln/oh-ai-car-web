import { useEffect, useState } from 'react';
import { FormModal } from '../../components/layout/FormModal.js';
import type { WhitelistEntry } from '../../services/api.js';
import * as opsClient from '../../services/opsClient.js';

const empty = {
  plate: '',
  owner: '',
  building: '',
  parkingSpot: '',
  vehicleType: 'private',
  validUntil: '',
};

export function WhitelistPage() {
  const [entries, setEntries] = useState<WhitelistEntry[]>([]);
  const [form, setForm] = useState(empty);
  const [csv, setCsv] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const refresh = async () => setEntries(await opsClient.whitelist());

  useEffect(() => {
    void refresh().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : '加载失败'));
  }, []);

  const closeAddDrawer = () => {
    setAddOpen(false);
    setError('');
  };

  const closeImportDrawer = () => {
    setImportOpen(false);
    setError('');
  };

  const add = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    try {
      await opsClient.addWhitelist({
        plate: form.plate.trim(),
        owner: form.owner || null,
        building: form.building || null,
        parkingSpot: form.parkingSpot || null,
        vehicleType: form.vehicleType,
        validUntil: form.validUntil || null,
      });
      setForm(empty);
      setMessage('已添加白名单');
      setAddOpen(false);
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '添加失败');
    }
  };

  const importCsv = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    try {
      const result = await opsClient.importWhitelist(csv);
      setMessage(`导入完成：成功 ${result.imported}，失败 ${result.failed}`);
      setCsv('');
      setImportOpen(false);
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '导入失败');
    }
  };

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>白名单管理</h1>
          <p>维护合法车辆白名单，支持单条新增与 CSV 批量导入</p>
        </div>
        <div className="button-row">
          <button type="button" className="primary" onClick={() => setAddOpen(true)}>新增白名单</button>
          <button type="button" className="secondary" onClick={() => setImportOpen(true)}>批量导入</button>
        </div>
      </header>
      {message && <p className="notice">{message}</p>}
      {error && !addOpen && !importOpen && <p className="error">{error}</p>}
      <section className="panel">
        <h2>白名单列表</h2>
        {entries.length === 0 ? (
          <div className="empty-state">
            <p>暂无白名单</p>
            <button type="button" className="primary" onClick={() => setAddOpen(true)}>新增白名单</button>
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>车牌</th>
                <th>车主</th>
                <th>楼栋</th>
                <th>车位</th>
                <th>类型</th>
                <th>有效期</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <td>{entry.plate}</td>
                  <td>{entry.owner ?? '-'}</td>
                  <td>{entry.building ?? '-'}</td>
                  <td>{entry.parkingSpot ?? '-'}</td>
                  <td>{entry.vehicleType ?? '-'}</td>
                  <td>{entry.validUntil ? new Date(entry.validUntil).toLocaleDateString() : '长期'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <FormModal open={addOpen} title="新增白名单" onClose={closeAddDrawer}>
        <form className="stack-form" onSubmit={(event) => void add(event)}>
          <label>车牌*<input required value={form.plate} onChange={(e) => setForm({ ...form, plate: e.target.value })} /></label>
          <label>车主<input value={form.owner} onChange={(e) => setForm({ ...form, owner: e.target.value })} /></label>
          <label>楼栋<input value={form.building} onChange={(e) => setForm({ ...form, building: e.target.value })} /></label>
          <label>车位<input value={form.parkingSpot} onChange={(e) => setForm({ ...form, parkingSpot: e.target.value })} /></label>
          <label>
            车辆类型
            <select value={form.vehicleType} onChange={(e) => setForm({ ...form, vehicleType: e.target.value })}>
              <option value="private">私家车</option>
              <option value="visitor">访客</option>
              <option value="commercial">商用</option>
            </select>
          </label>
          <label>有效期<input type="date" value={form.validUntil} onChange={(e) => setForm({ ...form, validUntil: e.target.value })} /></label>
          {error && <p className="error">{error}</p>}
          <button type="submit" className="primary">保存</button>
        </form>
      </FormModal>

      <FormModal open={importOpen} title="批量导入白名单" onClose={closeImportDrawer}>
        <form className="stack-form" onSubmit={(event) => void importCsv(event)}>
          <label className="stack-form">
            粘贴 CSV（plate,owner,building,parkingSpot,vehicleType,validUntil）
            <textarea rows={10} value={csv} onChange={(e) => setCsv(e.target.value)} required />
          </label>
          {error && <p className="error">{error}</p>}
          <button type="submit" className="primary" disabled={!csv.trim()}>开始导入</button>
        </form>
      </FormModal>
    </div>
  );
}
