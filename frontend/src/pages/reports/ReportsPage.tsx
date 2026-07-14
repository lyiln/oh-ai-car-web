import { useCallback, useEffect, useState } from 'react';
import type { PatrolReport } from '../../services/api.js';
import * as aiClient from '../../services/aiClient.js';
import type { AiDailyReport } from '../../services/aiClient.js';
import * as opsClient from '../../services/opsClient.js';
import { useSelectedDevice } from '../../contexts/SelectedDeviceContext.js';

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export function ReportsPage() {
  const { selectedDevice } = useSelectedDevice();
  const [reports, setReports] = useState<PatrolReport[]>([]);
  const [aiReports, setAiReports] = useState<AiDailyReport[]>([]);
  const [date, setDate] = useState(todayIsoDate());
  const [generating, setGenerating] = useState(false);
  const [preview, setPreview] = useState<string>('');
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    const [nextReports, nextAi] = await Promise.all([
      opsClient.reports(),
      aiClient.listDailyAiReports(),
    ]);
    setReports(nextReports);
    setAiReports(nextAi);
  }, []);

  useEffect(() => {
    void refresh().catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : '加载失败');
    });
  }, [refresh]);

  const generate = async () => {
    setGenerating(true);
    setError('');
    try {
      const result = await aiClient.generateDailyAiReport({
        date,
        deviceId: selectedDevice?.id,
      });
      setPreview(result.report.narrativeMarkdown);
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '生成 AI 报告失败');
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>报告中心</h1>
          <p>巡逻报告预览与下载 · AI 日报分析</p>
        </div>
        <div className="button-row">
          <label className="inline-field">
            <span>日期</span>
            <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          </label>
          <button type="button" disabled={generating} onClick={() => void generate()}>
            {generating ? '生成中…' : '生成今日 AI 报告'}
          </button>
        </div>
      </header>
      {error && <p className="error">{error}</p>}

      {preview && (
        <section className="panel mt-16">
          <h2>AI 报告预览</h2>
          <pre className="ai-report-markdown">{preview}</pre>
        </section>
      )}

      <section className="panel mt-16">
        <h2>AI 日报</h2>
        {aiReports.length === 0 ? (
          <div className="empty-state">暂无 AI 日报，请选择日期后生成</div>
        ) : (
          <div className="report-grid">
            {aiReports.map((report) => (
              <article key={report.id} className="panel report-card">
                <h2>{report.reportDate}</h2>
                <p className="muted">
                  {new Date(report.createdAt).toLocaleString()}
                  {report.deviceName ? ` · ${report.deviceName}` : ' · 全部设备'}
                </p>
                <dl className="status-dl">
                  <dt>闯入</dt>
                  <dd>{Number((report.stats as { intrusionCount?: number } | undefined)?.intrusionCount ?? 0)}</dd>
                  <dt>乱停</dt>
                  <dd>{Number((report.stats as { illegalParkingCount?: number } | undefined)?.illegalParkingCount ?? 0)}</dd>
                </dl>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setPreview(report.narrativeMarkdown)}
                >
                  查看正文
                </button>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="panel mt-16">
        <h2>任务级巡检报告</h2>
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
      </section>
    </div>
  );
}
