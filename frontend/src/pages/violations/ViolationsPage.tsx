import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
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

export function ViolationsPage() {
  const [items, setItems] = useState<Violation[]>([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    void opsClient.violations()
      .then(setItems)
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : '加载失败'));
  }, []);

  const filtered = items
    .filter((item) => !statusFilter || item.status === statusFilter)
    .slice()
    .sort((a, b) => (a.priority === 'high' ? -1 : 0) - (b.priority === 'high' ? -1 : 0));

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>违规车辆</h1>
          <p>禁停与外来车辆总览</p>
        </div>
      </header>
      <section className="panel filter-row">
        <label>
          处置状态
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">全部</option>
            <option value="pending">待处理</option>
            <option value="confirmed">已确认</option>
            <option value="resolved">已处理</option>
            <option value="false_positive">误报</option>
          </select>
        </label>
      </section>
      {error && <p className="error">{error}</p>}
      <section className="panel mt-16">
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
                <tr key={item.id}>
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
                  <td>{item.status ?? 'pending'}</td>
                  <td>
                    <Link to={`/map?violationId=${encodeURIComponent(item.id)}`}>定位</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
