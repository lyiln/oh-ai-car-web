import type { ConnectionConfig } from '@oh-ai-car-web/shared';

export function ConnectionSettings({ config, disabled, onChange, onConnect, onDisconnect }: {
  config: ConnectionConfig; disabled: boolean; onChange: (config: ConnectionConfig) => void; onConnect: () => void; onDisconnect: () => void;
}) {
  const update = (key: keyof ConnectionConfig, value: string) => onChange({ ...config, [key]: key === 'host' ? value : Number(value) });
  return <section className="panel connection-settings" aria-label="网络连接">
    <h2>网络连接</h2>
    <label>小车 IP<input aria-label="小车 IP" value={config.host} onChange={(event) => update('host', event.target.value)} disabled={disabled} /></label>
    <label>TCP 端口<input aria-label="TCP 端口" type="number" min="1" max="65535" value={config.tcpPort} onChange={(event) => update('tcpPort', event.target.value)} disabled={disabled} /></label>
    <label>视频端口<input aria-label="视频端口" type="number" min="1" max="65535" value={config.videoPort} onChange={(event) => update('videoPort', event.target.value)} disabled={disabled} /></label>
    <div className="button-row"><button onClick={onConnect} disabled={disabled}>连接</button><button className="secondary" onClick={onDisconnect}>断开</button></div>
  </section>;
}
