import { useEffect, useState } from 'react';
import type { PatrolReport } from '../../services/api.js';
import * as opsClient from '../../services/opsClient.js';

export function ReportsPage() {
  const [reports, setReports] = useState<PatrolReport[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    void opsClient.reports()
      .then(setReports)
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : '加载失败'));
  }, []);

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>报告中心</h1>
          <p>巡逻报告预览与下载</p>
        </div>
      </header>
      {error && <p className="error">{error}</p>}
      {reports.length === 0 ? (
        <div className="empty-state">暂无报告</div>
      ) : (
        <div className="report-grid">
          {reports.map((report) => (
            <article key={report.id} className="panel report-card">
              <h2>任务 {report.taskId.slice(0, 8)}</h2>
              <p className="muted">{report.date ?? '-'} · {report.deviceName ?? '设备'}</p>
              <dl className="status-dl">
                <dt>违规数</dt><dd>{report.violationCount ?? 0}</dd>
                <dt>外来车</dt><dd>{report.visitorCount ?? 0}</dd>
              </dl>
              {report.summary && <p>{report.summary}</p>}
              <div className="button-row">
                {report.htmlUrl ? <a href={report.htmlUrl} target="_blank" rel="noreferrer">HTML 预览</a> : <span className="muted">无 HTML</span>}
                {report.csvUrl && <a href={report.csvUrl}>CSV</a>}
                {report.zipUrl && <a href={report.zipUrl}>ZIP</a>}
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
