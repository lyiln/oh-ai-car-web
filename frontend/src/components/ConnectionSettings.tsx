import type { ConnectionConfig } from '@oh-ai-car-web/shared';

export function ConnectionSettings({ config, configDisabled, connectDisabled, disconnectDisabled, onChange, onConnect, onDisconnect }: {
  config: ConnectionConfig; configDisabled: boolean; connectDisabled: boolean; disconnectDisabled: boolean; onChange: (config: ConnectionConfig) => void; onConnect: () => void; onDisconnect: () => void;
}) {
  const update = (key: keyof ConnectionConfig, value: string) => onChange({ ...config, [key]: key === 'host' ? value : Number(value) });
  return <section className="panel connection-settings" aria-label="网络连接">
    <h2>网络连接</h2>
    <label>小车 IP<input aria-label="小车 IP" value={config.host} onChange={(event) => update('host', event.target.value)} disabled={configDisabled} /></label>
    <label>TCP 端口<input aria-label="TCP 端口" type="number" min="1" max="65535" value={config.tcpPort} onChange={(event) => update('tcpPort', event.target.value)} disabled={configDisabled} /></label>
    <label>视频端口<input aria-label="视频端口" type="number" min="1" max="65535" value={config.videoPort} onChange={(event) => update('videoPort', event.target.value)} disabled={configDisabled} /></label>
    <div className="button-row"><button onClick={onConnect} disabled={connectDisabled}>连接</button><button className="secondary" onClick={onDisconnect} disabled={disconnectDisabled}>断开</button></div>
  </section>;
}
