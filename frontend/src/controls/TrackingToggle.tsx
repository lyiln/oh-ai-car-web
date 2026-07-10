export function TrackingToggle({ disabled, pending, enabled, onChange }: { disabled: boolean; pending: boolean; enabled: boolean; onChange: (value: boolean) => Promise<void> }) {
  return <section className="panel"><h2>循迹</h2><label className="toggle"><input type="checkbox" disabled={disabled || pending} checked={enabled} onChange={(event) => { void onChange(event.target.checked).catch(() => undefined); }} /><span />{enabled ? '已开启' : '已关闭'}</label></section>;
}
