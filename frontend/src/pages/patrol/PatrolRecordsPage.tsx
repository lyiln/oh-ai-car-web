import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useSelectedDevice } from '../../contexts/SelectedDeviceContext.js';
import type { PatrolTask } from '../../services/api.js';
import * as patrolClient from '../../services/patrolClient.js';

function statusClass(status: string) {
  if (status === 'completed') return 'tag tag-success';
  if (status === 'failed') return 'tag tag-danger';
  if (status === 'running' || status === 'navigating') return 'tag tag-info';
  return 'tag tag-warning';
}

export function PatrolRecordsPage() {
  const { devices } = useSelectedDevice();
  const [tasks, setTasks] = useState<PatrolTask[]>([]);
  const [deviceFilter, setDeviceFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    void patrolClient.tasks()
      .then(setTasks)
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : '加载失败'));
  }, []);

  const filtered = useMemo(() => tasks.filter((task) => {
    if (deviceFilter && task.deviceId !== deviceFilter) return false;
    if (statusFilter && task.status !== statusFilter) return false;
    return true;
  }), [tasks, deviceFilter, statusFilter]);

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>巡逻记录</h1>
          <p>历史巡逻任务与报告入口</p>
        </div>
      </header>
      <section className="panel filter-row">
        <label>
          设备
          <select value={deviceFilter} onChange={(e) => setDeviceFilter(e.target.value)}>
            <option value="">全部</option>
            {devices.map((device) => <option key={device.id} value={device.id}>{device.name}</option>)}
          </select>
        </label>
        <label>
          状态
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">全部</option>
            <option value="running">进行中</option>
            <option value="completed">已完成</option>
            <option value="failed">失败</option>
          </select>
        </label>
      </section>
      {error && <p className="error">{error}</p>}
      <section className="panel mt-16">
        {filtered.length === 0 ? (
          <div className="empty-state">暂无巡逻记录</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>任务 ID</th>
                <th>巡逻小车</th>
                <th>开始</th>
                <th>结束</th>
                <th>航点完成率</th>
                <th>事件</th>
                <th>违规</th>
                <th>状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((task) => {
                const rate = task.waypointTotal
                  ? `${Math.round(((task.waypointDone ?? 0) / task.waypointTotal) * 100)}%`
                  : '-';
                return (
                  <tr key={task.id}>
                    <td>{task.id.slice(0, 8)}</td>
                    <td>{task.deviceName ?? task.deviceId}</td>
                    <td>{task.startedAt ? new Date(task.startedAt).toLocaleString() : '-'}</td>
                    <td>{task.endedAt ? new Date(task.endedAt).toLocaleString() : '-'}</td>
                    <td>{rate}</td>
                    <td>{task.eventCount ?? 0}</td>
                    <td>{task.violationCount ?? 0}</td>
                    <td><span className={statusClass(task.status)}>{task.status}</span></td>
                    <td><Link to={`/patrol/records/${task.id}`}>查看详情</Link></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
