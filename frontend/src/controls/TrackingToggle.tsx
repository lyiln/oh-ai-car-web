export function TrackingToggle({ disabled, enabled, onChange }: { disabled: boolean; enabled: boolean; onChange: (value: boolean) => void }) {
  return <section className="panel"><h2>循迹</h2><label className="toggle"><input type="checkbox" disabled={disabled} checked={enabled} onChange={(event) => onChange(event.target.checked)} /><span />{enabled ? '已开启' : '已关闭'}</label></section>;
}
