import { useCallback, useEffect, useState } from 'react';
import type { ResponseTask } from '../../services/api.js';
import * as responseClient from '../../services/responseClient.js';
import { useSelectedDevice } from '../../contexts/SelectedDeviceContext.js';

const labels: Record<string, string> = {
  pending_review: '待人工确认', confirmed: '待重试', assigned: '历史任务已分配', navigating: '历史任务导航中', arrived: '历史任务已到达',
  cancellation_requested: '正在安全取消', completed: '已完成', cancelled: '已取消', failed: '失败',
};

const pushLabels: Record<string, string> = {
  none: '未推送',
  queued: '推送中',
  sent: '已推送',
  failed: '推送失败',
  skipped_no_uid: '无 WxUID',
  skipped_not_configured: '未配置 WxPusher',
};

export function ResponseTasksPage() {
  const { selectedId } = useSelectedDevice();
  const [items, setItems] = useState<ResponseTask[]>([]);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState('');
  const refresh = useCallback(async () => {
    try { setItems(await responseClient.tasks()); setError(''); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '处置任务加载失败'); }
  }, []);

  useEffect(() => {
    void refresh();
    if (!selectedId) return undefined;
    const socket = new WebSocket(responseClient.liveUrl());
    socket.addEventListener('open', () => socket.send(JSON.stringify({ type: 'subscribe', vehicleId: selectedId })));
    socket.addEventListener('message', (event) => {
      try {
        const message = JSON.parse(String(event.data)) as { type?: string };
        if (message.type?.startsWith('response_') || message.type === 'assignment_changed') void refresh();
      } catch { /* ignore non-JSON frames */ }
    });
    return () => socket.close();
  }, [refresh, selectedId]);

  const confirm = async (id: string) => {
    setBusy(id); setMessage('');
    try {
      const result = await responseClient.confirm(id);
      setMessage(result.push?.message ?? (result.notificationCompleted ? '微信通知已发送' : '通知已确认，等待重试'));
      await refresh();
    }
    catch (reason) { setError(reason instanceof Error ? reason.message : '确认失败'); }
    finally { setBusy(''); }
  };

  const retryPush = async (id: string) => {
    setBusy(id); setMessage('');
    try { const result = await responseClient.retryPush(id); setMessage(result.push.message); await refresh(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '重新发送失败'); }
    finally { setBusy(''); }
  };

  const assign = async (id: string) => {
    setBusy(id); setMessage('');
    try { const result = await responseClient.assign(id); setMessage(`已分配至车辆 ${result.assignedVehicleId.slice(0, 8)}`); await refresh(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '分配失败'); }
    finally { setBusy(''); }
  };

  const cancel = async (id: string) => {
    setBusy(id);
    try { const result = await responseClient.cancel(id); setMessage(result.cancellationRequested ? '已请求设备安全停车，等待零速度确认' : '任务已取消'); await refresh(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '取消失败'); }
    finally { setBusy(''); }
  };

  return <div className="page">
    <header className="page-header"><div><h1>微信通知</h1><p>违规自动入库、人工复核后通过 WxPusher 通知车主</p></div><button className="secondary" onClick={() => void refresh()}>刷新</button></header>
    {message && <p className="notice">{message}</p>}{error && <p className="error">{error}</p>}
    <section className="panel">
      {items.length === 0 ? <div className="empty-state">暂无待通知的违规记录</div> : <table>
        <thead><tr><th>车牌/位置</th><th>车主</th><th>状态</th><th>WxPusher</th><th>通知建议</th><th>操作</th></tr></thead>
        <tbody>{items.map((item) => <tr key={item.id}>
          <td>
            <strong>{item.plate}</strong>{!item.notificationOnly && <span className="tag tag-warning">历史上门任务</span>}
            <br /><small>{item.waypoint} · 置信度 {(item.confidence * 100).toFixed(0)}%</small>
            {!item.notificationOnly && <><br /><small>目的地：{item.destinationName || '未设置'} · 执行车辆：{item.assignedVehicleName || '待分配'}</small></>}
          </td>
          <td>{item.ownerName || '未登记'}<br /><small>{item.building || '—'}</small></td>
          <td><span className={item.status === 'failed' ? 'tag tag-danger' : item.status === 'completed' ? 'tag tag-success' : 'tag tag-info'}>{labels[item.status] ?? item.status}</span></td>
          <td>
            <span className={item.smsStatus === 'sent' ? 'tag tag-success' : item.smsStatus === 'failed' ? 'tag tag-danger' : 'tag tag-warning'}>
              {pushLabels[item.smsStatus ?? 'none'] ?? item.smsStatus ?? '未推送'}
            </span>
            {item.smsError ? <><br /><small>{item.smsError}</small></> : null}
          </td>
          <td>{item.aiSuggestion || '人工确认后生成'}{item.notificationText && <><br /><small>通知：{item.notificationText}</small></>}</td>
          <td><div className="button-row">
            {item.notificationOnly && item.status === 'pending_review' && <button disabled={busy === item.id} className="primary" onClick={() => void confirm(item.id)}>确认并发送微信</button>}
            {item.notificationOnly && item.status === 'confirmed' && <button disabled={busy === item.id} className="primary" onClick={() => void retryPush(item.id)}>重新发送</button>}
            {!item.notificationOnly && item.status === 'confirmed' && <button disabled={busy === item.id} className="primary" onClick={() => void assign(item.id)}>重试分配</button>}
            {['pending_review', 'confirmed', 'assigned', 'navigating', 'arrived'].includes(item.status) && <button disabled={busy === item.id} className="secondary" onClick={() => void cancel(item.id)}>{item.status === 'pending_review' ? '驳回' : '取消'}</button>}
          </div></td>
        </tr>)}</tbody>
      </table>}
    </section>
  </div>;
}
