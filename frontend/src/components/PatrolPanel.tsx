import { useCallback, useEffect, useState } from 'react';
import { PlatformClient, type PatrolDetail, type PatrolRoute, type PatrolTask, type Vehicle, type Whitelist } from '../services/platformClient.js';

const routeExample = `waypoints:
  - name: 南门车道
    x: 1.2
    y: 2.4
    yaw: 0
    dwellSeconds: 8
    roi: [0.1, 0.2, 0.5, 0.5]
  - name: 1号楼前
    x: 4.8
    y: 2.1
    yaw: 1.57
    dwellSeconds: 8
  - name: 消防通道
    x: 8.2
    y: 3.6
    yaw: 3.14
    dwellSeconds: 10`;
const whitelistExample = `plate,ownerName,building,category
A12345,张三,1号楼,private
B23456,访客李四,南门,visitor`;

function label(status: PatrolTask['status']) { return ({ draft: '草稿', queued: '待调度', running: '巡检中', cancellation_requested: '取消请求中，等待零速度确认', stopped: '已停止（已确认）', completed: '已完成', failed: '失败' })[status]; }
function classification(value: string) { return ({ pending_review: '待复核', registered_private: '登记私家车', visitor: '访客', suspected_external: '疑似外来' })[value] ?? value; }

export function PatrolPanel({ client, vehicle, isAdmin, onStatus }: { client: PlatformClient; vehicle: Vehicle | null; isAdmin: boolean; onStatus: (value: string) => void }) {
  const [routes, setRoutes] = useState<PatrolRoute[]>([]); const [whitelists, setWhitelists] = useState<Whitelist[]>([]); const [tasks, setTasks] = useState<PatrolTask[]>([]); const [routeId, setRouteId] = useState(''); const [whitelistId, setWhitelistId] = useState(''); const [shift, setShift] = useState('日间巡检'); const [detail, setDetail] = useState<PatrolDetail | null>(null); const [routeName, setRouteName] = useState('小区日常巡检路线'); const [mapVersion, setMapVersion] = useState('map-v1'); const [yaml, setYaml] = useState(routeExample); const [whitelistName, setWhitelistName] = useState('业主与访客名单'); const [csv, setCsv] = useState(whitelistExample);
  const refresh = useCallback(async () => {
    if (!vehicle) { setRoutes([]); setWhitelists([]); setTasks([]); setDetail(null); return; }
    const [nextRoutes, nextWhitelists, nextTasks] = await Promise.all([client.patrolRoutes(vehicle.id), client.whitelists(vehicle.id), client.patrolTasks(vehicle.id)]);
    setRoutes(nextRoutes.routes); setWhitelists(nextWhitelists.whitelists); setTasks(nextTasks.tasks); setRouteId((current) => nextRoutes.routes.some((route) => route.id === current) ? current : nextRoutes.routes[0]?.id ?? ''); setWhitelistId((current) => nextWhitelists.whitelists.some((entry) => entry.id === current) ? current : nextWhitelists.whitelists[0]?.id ?? '');
  }, [client, vehicle]);
  useEffect(() => { void refresh().catch((error: unknown) => onStatus(error instanceof Error ? error.message : '无法读取巡检数据')); }, [refresh, onStatus]);
  const inspect = async (task: PatrolTask) => { if (!vehicle) return; try { setDetail(await client.patrolDetail(vehicle.id, task.id)); } catch (error) { onStatus(error instanceof Error ? error.message : '无法读取任务详情'); } };
  const createRoute = async () => { if (!vehicle) return; try { await client.createPatrolRoute(vehicle.id, { name: routeName, mapVersion, yaml }); onStatus('路线已导入。'); await refresh(); } catch (error) { onStatus(error instanceof Error ? error.message : '路线导入失败'); } };
  const createWhitelist = async () => { if (!vehicle) return; try { await client.createWhitelist(vehicle.id, { name: whitelistName, csv }); onStatus('白名单已导入。'); await refresh(); } catch (error) { onStatus(error instanceof Error ? error.message : '白名单导入失败'); } };
  const createTask = async () => { if (!vehicle || !routeId || !whitelistId) return onStatus('请先选择路线和白名单。'); try { await client.createPatrolTask(vehicle.id, { routeId, whitelistId, shift }); onStatus('巡检任务已创建。'); await refresh(); } catch (error) { onStatus(error instanceof Error ? error.message : '任务创建失败'); } };
  const start = async (task: PatrolTask) => { if (!vehicle) return; try { await client.startPatrolTask(vehicle.id, task.id); onStatus('任务已进入待调度状态，等待巡检车领取。'); await refresh(); await inspect({ ...task, status: 'queued' }); } catch (error) { onStatus(error instanceof Error ? error.message : '任务启动失败'); } };
  const stop = async (task: PatrolTask) => { if (!vehicle) return; try { await client.stopPatrolTask(vehicle.id, task.id); onStatus('已请求取消巡检，等待调度器确认已取消导航且车辆零速度。'); await refresh(); await inspect({ ...task, status: 'cancellation_requested' }); } catch (error) { onStatus(error instanceof Error ? error.message : '任务停止失败'); } };
  const download = async (task: PatrolTask) => { if (!vehicle) return; try { const report = await client.patrolReport(vehicle.id, task.id); const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([report.html], { type: 'text/html;charset=utf-8' })); link.download = `巡检报告-${task.id}.html`; link.click(); URL.revokeObjectURL(link.href); } catch (error) { onStatus(error instanceof Error ? error.message : '报告生成失败'); } };
  if (!vehicle) return <section className="panel"><h2>巡检任务</h2><p>请先在车辆页或轨迹地图中选择车辆。</p></section>;
  return <section className="patrol-layout">
    <section className="panel"><div className="panel-heading"><div><h2>巡检任务</h2><p>{vehicle.name} · 路线模板与实际巡检记录分开保存。</p></div><button className="secondary" onClick={() => void refresh()}>刷新</button></div><div className="patrol-create"><label>路线<select value={routeId} onChange={(event) => setRouteId(event.target.value)}><option value="">选择路线</option>{routes.map((route) => <option key={route.id} value={route.id}>{route.name}（{route.waypoints.length} 点）</option>)}</select></label><label>白名单<select value={whitelistId} onChange={(event) => setWhitelistId(event.target.value)}><option value="">选择白名单</option>{whitelists.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}（{entry.entryCount} 辆）</option>)}</select></label><label>班次<input value={shift} onChange={(event) => setShift(event.target.value)} /></label><button onClick={() => void createTask()} disabled={!routeId || !whitelistId}>创建巡检任务</button></div>{!routes.length || !whitelists.length ? <p className="notice">需先导入路线和白名单，才能创建任务。</p> : null}<div className="task-list">{tasks.map((task) => <article key={task.id} className={detail?.task.id === task.id ? 'task-selected' : ''}><div><strong>{task.routeName ?? task.routeId}</strong><span className={`status-${task.status}`}>{label(task.status)}</span><small>{task.shift} · {new Date(task.createdAt).toLocaleString()}</small></div><div className="task-actions"><button className="secondary" onClick={() => void inspect(task)}>详情</button>{task.status === 'draft' && <button onClick={() => void start(task)}>启动</button>}{(task.status === 'queued' || task.status === 'running') && <button className="danger" onClick={() => void stop(task)}>请求安全停止</button>}{task.status === 'cancellation_requested' && <span className="safety-pending">等待调度器确认零速度</span>}{(task.status === 'completed' || task.status === 'stopped' || task.status === 'failed') && <button onClick={() => void download(task)}>下载报告</button>}</div></article>)}</div></section>
    {isAdmin && <section className="two-column"><section className="panel import-panel"><h2>导入路线 YAML</h2><label>路线名称<input value={routeName} onChange={(event) => setRouteName(event.target.value)} /></label><label>地图版本<input value={mapVersion} onChange={(event) => setMapVersion(event.target.value)} /></label><label>航点 YAML<textarea value={yaml} onChange={(event) => setYaml(event.target.value)} rows={14} /></label><button onClick={() => void createRoute()}>导入路线</button></section><section className="panel import-panel"><h2>导入车辆白名单 CSV</h2><label>名单名称<input value={whitelistName} onChange={(event) => setWhitelistName(event.target.value)} /></label><label>CSV（plate,ownerName,building,category）<textarea value={csv} onChange={(event) => setCsv(event.target.value)} rows={14} /></label><button onClick={() => void createWhitelist()}>导入白名单</button></section></section>}
    {detail && <section className="panel"><div className="panel-heading"><div><h2>任务详情：{detail.task.routeName}</h2><p>{label(detail.task.status)} · {detail.events.length} 条调度事件 · {detail.observations.length} 条识别记录</p></div></div>{detail.task.failureReason && <p className="error">失败原因：{detail.task.failureReason}</p>}<table><thead><tr><th>车牌</th><th>判定</th><th>置信度</th><th>违规</th><th>航点</th><th>出现次数</th></tr></thead><tbody>{detail.observations.map((observation) => <tr key={observation.id}><td>{observation.plate ?? '待复核'}</td><td>{classification(observation.classification)}</td><td>{observation.confidence.toFixed(2)}</td><td>{observation.noParking ? '是' : '否'}</td><td>{observation.waypointId}</td><td>{observation.observationCount}</td></tr>)}{!detail.observations.length && <tr><td colSpan={6}>暂无识别记录</td></tr>}</tbody></table></section>}
  </section>;
}
