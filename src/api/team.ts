import { loadConfig } from './ipc';
import type { TeamConfig } from './types';

/** 企业版团队服务端（team-server）客户端：直接 fetch，服务端已为桌面 webview 放行 CORS */

interface TeamResp<T> {
  code: number;
  message: string;
  data: T;
}

export interface TeamMember {
  id: number;
  name: string;
  is_creator: number;
  created_at: string;
}

export interface TeamTask {
  id: number;
  title: string;
  description: string;
  tags: string;
  priority: string;
  period: string;
  /** open | claimed | done */
  status: string;
  coordinator_id: number;
  coordinator_name: string | null;
  claimer_id: number | null;
  claimer_name: string | null;
  latest_ledger: {
    progress: number;
    latest: string;
    problems: string;
    resources: string;
    created_at: string;
  } | null;
  created_at: string;
  updated_at: string;
}

export interface TeamLedger {
  id: number;
  task_id: number;
  member_id: number;
  progress: number;
  latest: string;
  problems: string;
  resources: string;
  created_at: string;
}

export interface SubmissionItem {
  task_id?: number;
  title?: string;
  content?: string;
}

export interface TeamSubmission {
  id: number;
  member_id: number;
  member_name?: string;
  date: string;
  task_items: SubmissionItem[];
  free_text: string;
  edit_count: number;
  created_at: string;
  updated_at: string;
  versions?: { content: string; saved_at: string }[];
}

export interface DaySubmissions {
  date: string;
  submissions: TeamSubmission[];
  missing: { id: number; name: string }[];
}

export interface DailyReportData {
  date: string;
  submissions: TeamSubmission[];
  missing: { id: number; name: string }[];
  text?: string;
  [k: string]: unknown;
}

export interface TeamComment {
  id: number;
  target_type: string;
  target_id: number;
  member_id: number;
  member_name?: string;
  kind: string;
  need_response: number;
  resolved: number;
  content: string;
  created_at: string;
}

export interface TeamChecklist {
  items: { title?: string; task_id?: number; hint?: string }[];
  generated_at: string;
}

/** 读取当前团队连接配置 */
export async function getTeamConfig(): Promise<TeamConfig> {
  try {
    const cfg = await loadConfig();
    return (
      cfg.team ?? { base_url: '', token: '', team_name: '', member_name: '' }
    );
  } catch {
    return { base_url: '', token: '', team_name: '', member_name: '' };
  }
}

async function call<T>(
  cfg: TeamConfig,
  path: string,
  init?: RequestInit & { query?: Record<string, string | undefined> }
): Promise<T> {
  if (!cfg.base_url) throw new Error('未配置团队服务端地址');
  const base = cfg.base_url.replace(/\/+$/, '');
  const url = new URL(base + path);
  for (const [k, v] of Object.entries(init?.query ?? {})) {
    if (v !== undefined && v !== '') url.searchParams.set(k, v);
  }
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (cfg.token) headers['X-Member-Token'] = cfg.token;
  const res = await fetch(url.toString(), { ...init, headers });
  const body = (await res.json()) as TeamResp<T>;
  if (body.code !== 0) throw new Error(body.message || `请求失败 (${body.code})`);
  return body.data;
}

// ---- 连接（无需 Token） ----

export const teamCreate = (cfg: TeamConfig, teamName: string, creatorName: string) =>
  call<{ team_id: number; invite_code: string; member: { id: number; name: string; token: string; is_creator: boolean } }>(
    cfg,
    '/api/team/create',
    { method: 'POST', body: JSON.stringify({ team_name: teamName, creator_name: creatorName }) }
  );

export const teamJoin = (cfg: TeamConfig, inviteCode: string, name: string) =>
  call<{ team_id: number; member: { id: number; name: string; token: string; is_creator: boolean } }>(
    cfg,
    '/api/team/join',
    { method: 'POST', body: JSON.stringify({ invite_code: inviteCode, name }) }
  );

export const teamHealth = (cfg: TeamConfig) =>
  call<{ status?: string; service?: string }>(cfg, '/api/health');

// ---- 需要成员 Token ----

export const membersList = (cfg: TeamConfig) => call<TeamMember[]>(cfg, '/api/members');

export const tasksList = (cfg: TeamConfig, status?: string) =>
  call<TeamTask[]>(cfg, '/api/tasks', { query: { status } });

export const taskCreate = (
  cfg: TeamConfig,
  body: { title: string; description?: string; priority?: string; period?: string; tags?: string }
) => call<unknown>(cfg, '/api/tasks', { method: 'POST', body: JSON.stringify(body) });

export const taskClaim = (cfg: TeamConfig, taskId: number) =>
  call<unknown>(cfg, '/api/tasks/claim', { method: 'POST', body: JSON.stringify({ task_id: taskId }) });

export const taskAbandon = (cfg: TeamConfig, taskId: number) =>
  call<unknown>(cfg, '/api/tasks/abandon', { method: 'POST', body: JSON.stringify({ task_id: taskId }) });

export const taskComplete = (cfg: TeamConfig, taskId: number) =>
  call<unknown>(cfg, '/api/tasks/complete', { method: 'POST', body: JSON.stringify({ task_id: taskId }) });

export const taskAutoAssign = (cfg: TeamConfig) =>
  call<unknown>(cfg, '/api/tasks/auto_assign', { method: 'POST', body: JSON.stringify({}) });

export const ledgerAdd = (
  cfg: TeamConfig,
  body: { task_id: number; progress: number; latest?: string; problems?: string; resources?: string }
) => call<unknown>(cfg, '/api/tasks/ledger', { method: 'POST', body: JSON.stringify(body) });

export const ledgerList = (cfg: TeamConfig, taskId: number) =>
  call<TeamLedger[]>(cfg, '/api/tasks/ledger', { query: { task_id: String(taskId) } });

export const submissionGet = (cfg: TeamConfig, date: string, memberId?: number) =>
  call<TeamSubmission | null>(cfg, '/api/submissions', {
    query: { date, member_id: memberId ? String(memberId) : undefined },
  });

export const submissionUpsert = (
  cfg: TeamConfig,
  body: { date: string; task_items: SubmissionItem[]; free_text: string }
) =>
  call<{ id: number; created: boolean; edited?: boolean }>(cfg, '/api/submissions', {
    method: 'POST',
    body: JSON.stringify(body),
  });

export const submissionsDay = (cfg: TeamConfig, date: string) =>
  call<DaySubmissions>(cfg, '/api/submissions/day', { query: { date } });

export const commentsList = (cfg: TeamConfig, targetType?: string, targetId?: number) =>
  call<TeamComment[]>(cfg, '/api/comments', {
    query: {
      target_type: targetType,
      target_id: targetId !== undefined ? String(targetId) : undefined,
    },
  });

export const commentAdd = (
  cfg: TeamConfig,
  body: { target_type: string; target_id: number; content: string; kind?: string; need_response?: boolean }
) => call<unknown>(cfg, '/api/comments', { method: 'POST', body: JSON.stringify(body) });

export const checklistGet = (cfg: TeamConfig, date: string) =>
  call<TeamChecklist | null>(cfg, '/api/checklist', { query: { date } });

export const checklistGenerate = (cfg: TeamConfig, date?: string) =>
  call<TeamChecklist>(cfg, '/api/checklist/generate', {
    method: 'POST',
    body: JSON.stringify({ date }),
  });

export const dailyReport = (cfg: TeamConfig, date: string) =>
  call<DailyReportData>(cfg, '/api/daily_report', { query: { date } });

export const dailyReportPush = (
  cfg: TeamConfig,
  body: { date?: string; channel_type: string; webhook_url: string; secret?: string }
) => call<unknown>(cfg, '/api/daily_report/push', { method: 'POST', body: JSON.stringify(body) });
