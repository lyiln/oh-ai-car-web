export function ConnectionStatus({ connected, ownsControl, controlAvailable, error, target }: { connected: boolean; ownsControl: boolean; controlAvailable: boolean; error: string | null; target: string | null }) {
  const controlledByOther = !ownsControl && !controlAvailable;
  const label = connected && ownsControl ? '已连接' : connected ? '其他页面正在控制' : controlledByOther ? '其他页面正在连接' : '未连接';
  return <section className="connection-status" aria-live="polite"><span className={connected && ownsControl ? 'status-dot online' : 'status-dot'} />
    <strong>{label}</strong><span>{connected && target ? target : error ?? '请配置小车地址并连接'}</span>
  </section>;
}
