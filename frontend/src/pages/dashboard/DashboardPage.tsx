import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { DashboardSummary, PatrolTask } from '../../services/api.js';
import * as opsClient from '../../services/opsClient.js';
import * as patrolClient from '../../services/patrolClient.js';

function statusTag(status: string) {
  if (status === 'completed') return 'tag tag-success';
  if (status === 'failed') return 'tag tag-danger';
  if (status === 'running' || status === 'navigating' || status === 'detecting') return 'tag tag-info';
  return 'tag tag-warning';
}

export function DashboardPage() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [tasks, setTasks] = useState<PatrolTask[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    void (async () => {
      try {
        const [nextSummary, nextTasks] = await Promise.all([
          opsClient.dashboardSummary(),
          patrolClient.tasks(),
        ]);
        setSummary(nextSummary);
        setTasks(nextSummary.recentTasks?.length ? nextSummary.recentTasks : nextTasks.slice(0, 8));
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : '加载工作台失败');
      }
    })();
  }, []);

  const alerts = summary?.alerts ?? [];

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>工作台</h1>
          <p>巡牌通运营总览</p>
        </div>
      </header>
      {error && <p className="error">{error}</p>}
      <section className="kpi-grid">
        <article className="kpi-card"><span>在线设备</span><strong>{summary?.onlineDevices ?? 0}</strong></article>
        <article className="kpi-card"><span>今日巡逻</span><strong>{summary?.todayPatrols ?? 0}</strong></article>
        <article className="kpi-card"><span>待审核</span><strong>{summary?.pendingReviews ?? 0}</strong></article>
        <article className="kpi-card"><span>违规车辆</span><strong>{summary?.violations ?? 0}</strong></article>
      </section>
      <section className="split-grid">
        <article className="panel">
          <h2>快捷操作</h2>
          <div className="shortcut-grid">
            <Link className="shortcut-btn" to="/fleet">新增设备</Link>
            <Link className="shortcut-btn" to="/console">进入控制台</Link>
            <Link className="shortcut-btn" to="/patrol/tasks">发起巡检</Link>
            <Link className="shortcut-btn" to="/reports">查看报告</Link>
          </div>
        </article>
        <article className="panel">
          <div className="panel-heading"><h2>最近巡逻记录</h2><Link to="/patrol/records">全部</Link></div>
          {tasks.length === 0 ? (
            <div className="empty-state">暂无巡逻记录</div>
          ) : (
            <table>
              <thead><tr><th>时间</th><th>设备</th><th>路线</th><th>状态</th><th>报告</th></tr></thead>
              <tbody>
                {tasks.map((task) => (
                  <tr key={task.id}>
                    <td>{task.startedAt ? new Date(task.startedAt).toLocaleString() : '-'}</td>
                    <td>{task.deviceName ?? task.deviceId}</td>
                    <td>{task.routeName ?? task.routeId}</td>
                    <td><span className={statusTag(task.status)}>{task.status}</span></td>
                    <td><Link to={`/patrol/records/${task.id}`}>查看</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </article>
      </section>
      <section className="panel mt-16">
        <h2>今日告警</h2>
        {alerts.length === 0 ? (
          <div className="empty-state">暂无告警</div>
        ) : (
          <ul className="alert-list">
            {alerts.map((alert) => (
              <li key={alert.id}>
                <span className={alert.priority === 'high' ? 'tag tag-danger' : 'tag tag-warning'}>
                  {alert.priority === 'high' ? '高优' : '告警'}
                </span>
                <span>{alert.message}</span>
                <small>{alert.occurredAt ? new Date(alert.occurredAt).toLocaleString() : ''}</small>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
