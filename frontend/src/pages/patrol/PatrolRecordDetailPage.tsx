import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { LiveMap } from '../../components/map/LiveMap.js';
import type { PatrolEvent, PatrolReport, PatrolTask, TrackPoint } from '../../services/api.js';
import * as deviceClient from '../../services/deviceClient.js';
import * as patrolClient from '../../services/patrolClient.js';

type Tab = 'timeline' | 'map' | 'report' | 'disposition';

export function PatrolRecordDetailPage() {
  const { id = '' } = useParams();
  const [tab, setTab] = useState<Tab>('timeline');
  const [task, setTask] = useState<PatrolTask | null>(null);
  const [events, setEvents] = useState<PatrolEvent[]>([]);
  const [report, setReport] = useState<PatrolReport | null>(null);
  const [points, setPoints] = useState<TrackPoint[]>([]);
  const [error, setError] = useState('');

  const previewHtml = () => {
    if (!report?.htmlContent) return;
    const url = URL.createObjectURL(new Blob([report.htmlContent], { type: 'text/html;charset=utf-8' }));
    window.open(url, '_blank', 'noopener,noreferrer'); window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };
  const downloadCsv = () => {
    if (!report?.csvContent) return;
    const url = URL.createObjectURL(new Blob([`\uFEFF${report.csvContent}`], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `patrol-report-${report.taskId.slice(0, 8)}.csv`; anchor.click(); URL.revokeObjectURL(url);
  };

  useEffect(() => {
    if (!id) return;
    void (async () => {
      try {
        const [nextTask, nextEvents, nextReport] = await Promise.all([
          patrolClient.task(id),
          patrolClient.events(id),
          patrolClient.report(id),
        ]);
        setTask(nextTask);
        setEvents(nextEvents);
        setReport(nextReport);
        if (nextTask?.deviceId) {
          const track = await deviceClient.track(nextTask.deviceId, nextTask.startedAt ?? undefined, nextTask.endedAt ?? undefined);
          setPoints(track);
        }
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : '加载详情失败');
      }
    })();
  }, [id]);

  const confirmed = events.filter((event) => event.verdict === 'confirmed').length;
  const falsePositive = events.filter((event) => event.verdict === 'false_positive').length;
  const pending = events.length - confirmed - falsePositive;

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>巡逻记录详情</h1>
          <p><Link to="/patrol/records">返回列表</Link></p>
        </div>
      </header>
      {error && <p className="error">{error}</p>}
      <section className="panel">
        <h2>任务概览</h2>
        {!task ? <div className="empty-state">未找到任务</div> : (
          <dl className="status-dl">
            <dt>设备</dt><dd>{task.deviceName ?? task.deviceId}</dd>
            <dt>路线</dt><dd>{task.routeName ?? task.routeId}</dd>
            <dt>状态</dt><dd>{task.status}</dd>
            <dt>航点完成率</dt>
            <dd>{task.waypointTotal ? `${task.waypointDone ?? 0}/${task.waypointTotal}` : '-'}</dd>
          </dl>
        )}
      </section>
      <div className="login-tabs page-tabs" role="tablist">
        {([
          ['timeline', '事件时间线'],
          ['map', '轨迹地图'],
          ['report', '巡逻报告'],
          ['disposition', '处置状态'],
        ] as const).map(([key, label]) => (
          <button key={key} type="button" className={tab === key ? 'login-tab-active' : undefined} onClick={() => setTab(key)}>{label}</button>
        ))}
      </div>
      <section className="panel mt-12">
        {tab === 'timeline' && (
          events.length === 0 ? <div className="empty-state">暂无识别事件</div> : (
            <table>
              <thead><tr><th>时间</th><th>车牌</th><th>判定</th><th>航点</th></tr></thead>
              <tbody>
                {events.map((event) => (
                  <tr key={event.id}>
                    <td>{new Date(event.occurredAt).toLocaleString()}</td>
                    <td>{event.plate ?? '未识别'}</td>
                    <td>{event.verdict ?? '-'}</td>
                    <td>{event.waypoint ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        )}
        {tab === 'map' && <LiveMap points={points} follow={false} />}
        {tab === 'report' && (
          !report ? <div className="empty-state">报告尚未生成</div> : (
            <div className="stack-form">
              <p>{report.summary ?? `任务 ${report.taskId} 报告`}</p>
              <div className="button-row">
                <button type="button" className="secondary" disabled={!report.htmlContent} onClick={previewHtml}>HTML 预览</button>
                <button type="button" className="secondary" disabled={!report.csvContent} onClick={downloadCsv}>下载 CSV</button>
              </div>
            </div>
          )
        )}
        {tab === 'disposition' && (
          <div className="kpi-grid">
            <article className="kpi-card"><span>已确认</span><strong>{confirmed}</strong></article>
            <article className="kpi-card"><span>误报</span><strong>{falsePositive}</strong></article>
            <article className="kpi-card"><span>待处理</span><strong>{pending}</strong></article>
          </div>
        )}
      </section>
    </div>
  );
}
