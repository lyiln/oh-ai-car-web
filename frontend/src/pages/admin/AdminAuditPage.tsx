import { useEffect, useMemo, useState } from 'react';
import { PlatformClient, type AuditLog } from '../../services/platformClient.js';

const client = new PlatformClient();
export function AdminAuditPage() {
  const [logs, setLogs] = useState<AuditLog[]>([]); const [query, setQuery] = useState(''); const [error, setError] = useState('');
  useEffect(() => { void client.audit().then((result) => setLogs(result.logs)).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : '加载失败')); }, []);
  const filtered = useMemo(() => logs.filter((entry) => `${entry.action} ${entry.outcome} ${entry.vehicleId ?? ''}`.toLowerCase().includes(query.toLowerCase())), [logs, query]);
  return <div className="page"><header className="page-header"><div><h1>审计日志</h1><p>最近 200 条平台操作记录</p></div></header><section className="panel filter-row"><label>筛选<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="动作 / 结果 / 车辆 ID" /></label></section>{error && <p className="error">{error}</p>}<section className="panel mt-16"><table><thead><tr><th>时间</th><th>动作</th><th>结果</th><th>车辆</th><th>详情</th></tr></thead><tbody>{filtered.map((entry) => <tr key={entry.id}><td>{new Date(entry.createdAt).toLocaleString()}</td><td>{entry.action}</td><td>{entry.outcome}</td><td>{entry.vehicleId ?? '-'}</td><td><code>{JSON.stringify(entry.metadata)}</code></td></tr>)}</tbody></table></section></div>;
}
