import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { EvidenceImage } from '../../components/EvidenceImage.js';
import type { Violation } from '../../services/api.js';
import * as opsClient from '../../services/opsClient.js';

function formatCoordPair(item: Violation): string {
  if (
    item.longitude == null ||
    item.latitude == null ||
    !Number.isFinite(item.longitude) ||
    !Number.isFinite(item.latitude)
  ) {
    return '-';
  }
  return `${item.longitude.toFixed(6)}, ${item.latitude.toFixed(6)}`;
}

function statusLabel(status?: string | null): string {
  switch (status) {
    case 'pending': return '待处理';
    case 'confirmed': return '已确认';
    case 'false_positive': return '误报';
    case 'resolved': return '已处理';
    case 'processed': return '已处理';
    case 'dismissed': return '已驳回';
    default: return status || 'pending';
  }
}

export function ViolationsPage() {
  const [items, setItems] = useState<Violation[]>([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    void opsClient.violations()
      .then(setItems)
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : '加载失败'));
  }, []);

  const filtered = items
    .filter((item) => !statusFilter || item.status === statusFilter)
    .slice()
    .sort((a, b) => (a.priority === 'high' ? -1 : 0) - (b.priority === 'high' ? -1 : 0));
  const selected = filtered.find((item) => item.id === selectedId) ?? filtered[0] ?? null;

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>违规车辆</h1>
          <p>禁停与外来车辆总览 · 审核确认/误报后状态会同步到这里 · 点击行可查看证据图</p>
        </div>
      </header>
      <section className="panel filter-row">
        <label>
          处置状态
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">全部</option>
            <option value="pending">待处理</option>
            <option value="confirmed">已确认（审核通过）</option>
            <option value="false_positive">误报</option>
            <option value="resolved">已处理（加白名单/外来标记）</option>
          </select>
        </label>
      </section>
      {error && <p className="error">{error}</p>}
      <div className="violations-layout mt-16">
        <section className="panel">
          {filtered.length === 0 ? (
            <div className="empty-state">暂无违规记录</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>车牌</th>
                  <th>类型</th>
                  <th>位置/航点</th>
                  <th>坐标</th>
                  <th>车主/楼栋</th>
                  <th>禁停区</th>
                  <th>发现时间</th>
                  <th>优先级</th>
                  <th>状态</th>
                  <th>地图</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((item) => (
                  <tr
                    key={item.id}
                    className={selected?.id === item.id ? 'table-row-active' : undefined}
                    onClick={() => setSelectedId(item.id)}
                    style={{ cursor: 'pointer' }}
                  >
                    <td>{item.plate}</td>
                    <td>{item.type}</td>
                    <td>{item.location ?? item.waypoint ?? '-'}</td>
                    <td>
                      <span title={item.coordinateSource === 'telemetry' ? '巡检车遥测回填' : item.coordinateSource === 'observation' ? '观测直传' : '暂无坐标'}>
                        {formatCoordPair(item)}
                      </span>
                    </td>
                    <td>
                      {[item.ownerName, item.building, item.parkingSpot].filter(Boolean).join(' · ') || '-'}
                    </td>
                    <td>{item.zoneName ?? '-'}</td>
                    <td>{new Date(item.occurredAt).toLocaleString()}</td>
                    <td>
                      <span className={item.priority === 'high' ? 'tag tag-danger' : 'tag tag-warning'}>
                        {item.priority === 'high' ? '高' : '普通'}
                      </span>
                    </td>
                    <td>{statusLabel(item.status)}</td>
                    <td>
                      <Link to={`/map?violationId=${encodeURIComponent(item.id)}`} onClick={(event) => event.stopPropagation()}>定位</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
        <aside className="panel violations-evidence-panel">
          <div className="panel-heading">
            <h2>{selected?.plate || '证据预览'}</h2>
            {selected && <span className="tag">{statusLabel(selected.status)}</span>}
          </div>
          {selected ? (
            <>
              <p className="muted">
                {new Date(selected.occurredAt).toLocaleString()}
                {' · '}
                {selected.location ?? selected.waypoint ?? '未知位置'}
              </p>
              <EvidenceImage url={selected.evidenceUrl} alt={`证据 ${selected.plate || '违规'}`} />
              <div className="button-row">
                <Link className="secondary" to={`/map?violationId=${encodeURIComponent(selected.id)}`}>地图定位</Link>
                <Link className="primary" to="/reviews">去审核队列</Link>
              </div>
            </>
          ) : (
            <div className="empty-state">选择一条违规记录查看车牌截图</div>
          )}
        </aside>
      </div>
    </div>
  );
}
