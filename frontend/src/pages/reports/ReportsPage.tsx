import { useEffect, useState } from 'react';
import type { PatrolReport } from '../../services/api.js';
import * as opsClient from '../../services/opsClient.js';

export function ReportsPage() {
  const [reports, setReports] = useState<PatrolReport[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  useEffect(() => {
    void opsClient.reports()
      .then(setReports)
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : '加载失败'));
  }, []);

  const showHtml = (content: string) => {
    const url = URL.createObjectURL(new Blob([content], { type: 'text/html;charset=utf-8' }));
    window.open(url, '_blank', 'noopener,noreferrer');
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };
  const downloadCsv = (content: string, taskId: string) => {
    const url = URL.createObjectURL(new Blob([`\uFEFF${content}`], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `patrol-report-${taskId.slice(0, 8)}.csv`; anchor.click();
    URL.revokeObjectURL(url);
  };
  const openReport = async (report: PatrolReport, action: 'html' | 'csv') => {
    setBusy(`${report.id}:${action}`); setError('');
    try {
      const detail = await opsClient.report(report.id);
      if (!detail) throw new Error('报告不存在');
      if (action === 'html') {
        if (!detail.htmlContent) throw new Error('报告 HTML 内容为空');
        showHtml(detail.htmlContent);
      } else {
        if (!detail.csvContent) throw new Error('报告 CSV 内容为空');
        downloadCsv(detail.csvContent, detail.taskId);
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : '报告操作失败'); }
    finally { setBusy(''); }
  };

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
                <button type="button" className="secondary" disabled={Boolean(busy)} onClick={() => void openReport(report, 'html')}>HTML 预览</button>
                <button type="button" className="secondary" disabled={Boolean(busy)} onClick={() => void openReport(report, 'csv')}>下载 CSV</button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
