import { tool } from 'langchain';
import { z } from 'zod';
import type { Database } from '../../db/index.js';
import type { ToolContext } from '../types.js';
import { diagnoseDeviceConnection, queryDevices } from './devices.js';
import { getProjectWorkflow } from './docs.js';
import { buildDailyReportStats, queryDailyObservations } from './observations.js';
import { queryDashboardSummary, queryPatrolReport, queryPatrolTasksByDate } from './patrol.js';
import { queryWhitelist } from './whitelist.js';

export function createAdvisorTools(db: Database, ctx: ToolContext) {
  const whitelistTools = ctx.user.role === 'admin'
    ? [tool(
      async ({ q }) => JSON.stringify(await queryWhitelist(db, ctx, q)),
      {
        name: 'list_whitelist',
        description: '查询当前全局白名单车辆列表，可选关键词过滤车牌/车主/楼栋',
        schema: z.object({
          q: z.string().optional().describe('可选搜索关键词'),
        }),
      },
    )]
    : [];
  return [
    tool(
      async () => JSON.stringify(getProjectWorkflow()),
      {
        name: 'get_project_workflow',
        description: '获取巡牌通平台完整工作流程、连接排查要点与安全规则',
        schema: z.object({}),
      },
    ),
    ...whitelistTools,
    tool(
      async () => JSON.stringify(await queryDevices(db, ctx)),
      {
        name: 'list_devices',
        description: '列出当前用户可访问的巡检设备及其在线状态',
        schema: z.object({}),
      },
    ),
    tool(
      async ({ deviceId }) => JSON.stringify(await diagnoseDeviceConnection(db, ctx, deviceId)),
      {
        name: 'diagnose_device_connection',
        description: '诊断指定设备为何无法连接：离线、租约占用、巡检中、Bridge 未配置等',
        schema: z.object({
          deviceId: z.string().describe('设备 UUID'),
        }),
      },
    ),
    tool(
      async ({ date, deviceId }) => JSON.stringify(await queryPatrolTasksByDate(db, ctx, date, deviceId)),
      {
        name: 'get_patrol_tasks_by_date',
        description: '按日期查询巡检任务列表（YYYY-MM-DD）',
        schema: z.object({
          date: z.string().describe('日期 YYYY-MM-DD'),
          deviceId: z.string().optional().describe('可选设备 UUID'),
        }),
      },
    ),
    tool(
      async ({ taskId }) => JSON.stringify(await queryPatrolReport(db, ctx, taskId)),
      {
        name: 'get_patrol_report',
        description: '查询指定巡检任务的报告统计摘要',
        schema: z.object({
          taskId: z.string().describe('巡检任务 UUID'),
        }),
      },
    ),
    tool(
      async () => JSON.stringify(await queryDashboardSummary(db, ctx)),
      {
        name: 'get_dashboard_summary',
        description: '获取工作台摘要：在线设备、今日巡逻、待审核、待处理违规',
        schema: z.object({}),
      },
    ),
    tool(
      async ({ date, deviceId }) => {
        const data = await queryDailyObservations(db, ctx, date, deviceId);
        return JSON.stringify({
          ...data,
          stats: buildDailyReportStats(date, data),
        });
      },
      {
        name: 'get_daily_observations',
        description: '获取指定日期的车牌观测与违规聚合，用于回答日报相关问题',
        schema: z.object({
          date: z.string().describe('日期 YYYY-MM-DD'),
          deviceId: z.string().optional(),
        }),
      },
    ),
  ];
}

export {
  diagnoseDeviceConnection,
  getProjectWorkflow,
  queryDashboardSummary,
  queryDailyObservations,
  queryDevices,
  queryPatrolReport,
  queryPatrolTasksByDate,
  queryWhitelist,
  buildDailyReportStats,
};
