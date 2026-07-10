export function ConnectionStatus({ connected, error, target }: { connected: boolean; error: string | null; target: string | null }) {
  return <section className="connection-status" aria-live="polite"><span className={connected ? 'status-dot online' : 'status-dot'} />
    <strong>{connected ? '已连接' : '未连接'}</strong><span>{connected && target ? target : error ?? '请配置小车地址并连接'}</span>
  </section>;
}
