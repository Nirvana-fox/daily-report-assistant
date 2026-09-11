import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import type {
  AppUsageRecord,
  CategoryStat,
  Config,
  DailyStat,
  ExportFormat,
  GenerateRequest,
  GenerateResult,
  HeatMapRecord,
  LlmMode,
  LlmProvider,
  MonitorInfo,
  AssistantMessageRow,
  PushStats,
  NasSyncStats,
  PlanTask,
  PurgeStats,
  Report,
  ReportTemplate,
  SourceStat,
  StorageStats,
  Todo,
  WatchEvent,
  WorkLog,
} from './types';

const DEFAULT_CONFIG: Config = {
  llm: {
    providers: [],
    default_text_id: '',
    default_vision_id: '',
    default_local_vision_id: '',
    use_local_vision: false,
  },
  screenshot: {
    enabled: true,
    interval_seconds: 30,
    keep_after_analysis: false,
    output_dir: '',
    auto_start: false,
    monitor_index: 0,
    idle_skip_seconds: 120,
    dedup_screenshots: true,
  },
  report: {
    default_template: 'standard',
    language: 'zh-CN',
    user_name: '',
    team: '',
    custom_instructions: '',
  },
  profile: {
    display_name: '',
    aliases: '',
    role: '',
    org: '',
    projects: '',
    responsibilities: '',
    collaborators: '',
    extra: '',
  },
  push: {
    enabled: false,
    daily_time: '18:30',
    daily_days: [1, 2, 3, 4, 5],
    weekly_enabled: false,
    weekly_day: 5,
    channels: [],
  },
  app: {
    auto_launch_on_boot: false,
    silent_launch: false,
    cleanup_keep_days: 90,
  },
  todo: {
    hotkey: 'Alt+Space',
  },
  nas: {
    enabled: false,
    base_url: '',
    token: '',
    device_id: '',
    device_name: '',
    sync_images: true,
    sync_interval_seconds: 30,
  },
  git: {
    enabled: false,
    repos: [],
    author_emails: [],
    author_names: [],
    poll_interval_seconds: 600,
  },
  shortcuts: {
    local_llm_toggle: 'Ctrl+Alt+L',
  },
  db_path: '',
};

async function safeInvoke<T>(cmd: string, args?: Record<string, unknown>, fallback: T = {} as T): Promise<T> {
  try {
    return await invoke<T>(cmd, args);
  } catch {
    return fallback;
  }
}

async function safeListen<T>(eventName: string, cb: (payload: T) => void): Promise<UnlistenFn> {
  try {
    return await listen<T>(eventName, (evt) => cb(evt.payload));
  } catch {
    return () => {};
  }
}

// ===== 配置 =====
export const loadConfig = () => safeInvoke<Config>('load_config', undefined, DEFAULT_CONFIG);
export const saveConfig = (cfg: Config) => safeInvoke<void>('save_config', { cfg });

// ===== 存储 =====
export const listWorkLogs = (start: string, end: string, source?: string) =>
  safeInvoke<WorkLog[]>('list_work_logs', { start, end, source }, []);

export const listReports = (limit: number) =>
  safeInvoke<Report[]>('list_reports', { limit }, []);

export const getReport = (id: number) =>
  safeInvoke<Report | null>('get_report', { id }, null);

export const deleteReport = (id: number) =>
  safeInvoke<boolean>('delete_report', { id }, false);

export const readTextFile = (path: string) =>
  safeInvoke<string>('read_text_file', { path }, '');

export const searchReports = (
  kind?: string,
  startDate?: string,
  endDate?: string,
  keyword?: string,
) =>
  safeInvoke<Report[]>('search_reports', {
    kind: kind || undefined,
    start_date: startDate || undefined,
    end_date: endDate || undefined,
    keyword: keyword || undefined,
  }, []);

export const deleteWorkLog = (id: number) =>
  safeInvoke<boolean>('delete_work_log', { id }, false);

export const storageStats = () => safeInvoke<StorageStats>('storage_stats', undefined, { work_logs_total: 0, reports_total: 0 });

export const categoryStats = (start: string, end: string) =>
  safeInvoke<CategoryStat[]>('category_stats', { start, end }, []);

export const dailyStats = (days: number) =>
  safeInvoke<DailyStat[]>('daily_stats', { days }, []);

export const sourceStats = (start: string, end: string) =>
  safeInvoke<SourceStat[]>('source_stats', { start, end }, []);

export const purgeBefore = (days: number) =>
  safeInvoke<PurgeStats>('purge_before', { days }, { work_logs: 0, reports: 0 });

export const purgeAll = () => safeInvoke<PurgeStats>('purge_all', undefined, { work_logs: 0, reports: 0 });

// ===== 截图 =====
export const listMonitors = () => safeInvoke<MonitorInfo[]>('list_monitors', undefined, []);

export const captureOnce = () => safeInvoke<WorkLog>('capture_once', undefined, {
  id: 0,
  ts: new Date().toISOString(),
  source: 'manual',
  title: '模拟截图',
  content: '这是浏览器环境下的模拟截图记录',
  meta: {},
  created_at: new Date().toISOString(),
});

export const startWatch = () => safeInvoke<void>('start_watch');

export const stopWatch = () => safeInvoke<void>('stop_watch');

export const isWatching = () => safeInvoke<boolean>('is_watching', undefined, false);

// ===== 时间线手动记录 =====
export const addManualLog = (description: string, ts?: string) =>
  safeInvoke<WorkLog>('add_manual_log', { description, ts }, {
    id: 0,
    ts: ts || new Date().toISOString(),
    source: 'manual',
    title: description.substring(0, 30) + (description.length > 30 ? '...' : ''),
    content: description,
    meta: {},
    created_at: new Date().toISOString(),
  });

// ===== 待办 =====
export const addTodo = (content: string) =>
  safeInvoke<Todo>('add_todo', { content }, {
    id: 0,
    content,
    status: 'pending',
    created_at: new Date().toISOString(),
  });

export const listTodos = (status?: string) =>
  safeInvoke<Todo[]>('list_todos', { status }, []);

export const completeTodo = (id: number) =>
  safeInvoke<Todo>('complete_todo', { id }, {
    id,
    content: '',
    status: 'done',
    created_at: new Date().toISOString(),
    completed_at: new Date().toISOString(),
  });

export const deleteTodo = (id: number) =>
  safeInvoke<boolean>('delete_todo', { id }, false);

export const updateTodo = (id: number, content: string) =>
  safeInvoke<Todo>('update_todo', { id, content }, {
    id,
    content,
    status: 'pending',
    created_at: new Date().toISOString(),
  });

export const showTodoPopup = () => safeInvoke<void>('show_todo_popup');

export const showTodoQuick = () => safeInvoke<void>('show_todo_popup');

export const showTodoList = () => safeInvoke<void>('show_todo_popup');

export const onTodosChanged = (cb: () => void): Promise<UnlistenFn> => safeListen('todos-changed', cb);

// ===== 报告 =====
export const generateReport = (request: GenerateRequest) =>
  safeInvoke<GenerateResult>('generate_report', { request }, {
    kind: request.kind,
    period_start: new Date().toISOString(),
    period_end: new Date().toISOString(),
    template: request.template || 'standard',
    content: `# ${request.kind === 'Daily' ? '日报' : request.kind === 'Weekly' ? '周报' : '月报'}\n\n这是浏览器环境下的模拟报告内容。\n\n## 工作内容\n\n- 暂无数据\n\n## 待办完成\n\n- 暂无数据\n`,
    commit_count: 0,
    screenshot_count: 0,
    todo_count: 0,
    report_id: 0,
  });

export const listTemplates = () => safeInvoke<ReportTemplate[]>('list_templates', undefined, [
  { key: 'standard', label: '标准模板', system_prompt: '', user_prompt_hint: '' },
  { key: 'simple', label: '简洁模板', system_prompt: '', user_prompt_hint: '' },
]);

export const addTemplate = (key: string, label: string, systemPrompt: string, userPromptHint: string) =>
  safeInvoke<number>('add_template', { key, label, systemPrompt, userPromptHint }, 0);

export const updateTemplate = (key: string, label: string, systemPrompt: string, userPromptHint: string) =>
  safeInvoke<boolean>('update_template', { key, label, systemPrompt, userPromptHint }, false);

export const deleteTemplate = (key: string) =>
  safeInvoke<boolean>('delete_template', { key }, false);

export const addPlanTask = (request: {
  title: string;
  description: string;
  start_date: string;
  end_date: string;
  start_time: string;
  end_time: string;
  cycle_type: string;
  priority: string;
  tags: string;
  progress: number;
  status: string;
  parent_id: number | null;
  period: string;
}) => safeInvoke<number>('add_plan_task', { request }, 0);

export const updatePlanTask = (request: {
  id: number;
  title: string;
  description: string;
  start_date: string;
  end_date: string;
  start_time: string;
  end_time: string;
  cycle_type: string;
  priority: string;
  tags: string;
  progress: number;
  status: string;
  parent_id: number | null;
  period: string;
}) => safeInvoke<boolean>('update_plan_task', { request }, false);

export const deletePlanTask = (id: number) =>
  safeInvoke<boolean>('delete_plan_task', { id }, false);

export const listPlanTasks = (startDate?: string, endDate?: string) => {
  const args: Record<string, unknown> = {};
  if (startDate) args.start_date = startDate;
  if (endDate) args.end_date = endDate;
  return safeInvoke<PlanTask[]>('list_plan_tasks', args, []);
};

export const getPlanTask = (id: number) =>
  safeInvoke<PlanTask | null>('get_plan_task', { id }, null);

export const exportReport = (id: number, format: ExportFormat, outDir: string) =>
  safeInvoke<string>('export_report', { id, format, outDir }, '');

// ===== LLM =====
export const testLlmConnection = (provider: LlmProvider) =>
  safeInvoke<[boolean, string]>('test_llm_connection', { provider }, [false, '浏览器环境不支持测试连接']);

export const chatLlm = (prompt: string, providerId?: string) => {
  const args: Record<string, unknown> = { prompt };
  if (providerId) args.provider_id = providerId;
  return safeInvoke<string>('chat_llm', args, '');
};

// ===== 其它 =====
export const openLogDir = () => safeInvoke<void>('open_log_dir');

// ===== 统计数据（本地 SQLite 聚合） =====
export const getAppUsage = (startDate?: string, endDate?: string) => {
  const args: Record<string, unknown> = {};
  if (startDate) args.startDate = startDate;
  if (endDate) args.endDate = endDate;
  return safeInvoke<AppUsageRecord[]>('get_app_usage', args, []);
};

export const getHeatMap = (startDate?: string, endDate?: string) => {
  const args: Record<string, unknown> = {};
  if (startDate) args.startDate = startDate;
  if (endDate) args.endDate = endDate;
  return safeInvoke<HeatMapRecord[]>('get_heat_map', args, []);
};

// ===== 图片预览 =====
export const readImageBase64 = (path: string) =>
  safeInvoke<string>('read_image_base64', { path }, '');

// ===== AI 助手 =====
export const assistantLoadHistory = (limit = 60) =>
  safeInvoke<AssistantMessageRow[]>('assistant_load_history', { limit }, []);

export const assistantClearHistory = () =>
  safeInvoke<number>('assistant_clear_history', undefined, 0);

export const assistantChat = (userMessage: string, providerId?: string) => {
  const args: Record<string, unknown> = { userMessage };
  if (providerId) args.providerId = providerId;
  return safeInvoke<string>('assistant_chat', args, '');
};

export const saveAssistantReport = (
  content: string,
  kind: 'daily' | 'weekly',
  anchor?: string
) => {
  const args: Record<string, unknown> = { content, kind };
  if (anchor) args.anchor = anchor;
  return safeInvoke<number>('save_assistant_report', args, 0);
};

// ===== 推送机器人 =====
export const pushRunNow = (force: boolean) =>
  safeInvoke<PushStats>('push_run_now', { force }, {
    generated_daily: false,
    generated_weekly: false,
    report_id: 0,
    weekly_report_id: 0,
    deliveries: [],
  });

// ===== NAS 数据同步 =====
export const nasTestConnection = () =>
  safeInvoke<[boolean, string]>('nas_test_connection', undefined, [
    false,
    '浏览器环境不支持',
  ]);

export const nasSyncNow = () =>
  safeInvoke<NasSyncStats>('nas_sync_now', undefined, {
    pushed_records: 0,
    pushed_images: 0,
    pushed_usage: 0,
    failed: true,
    message: '浏览器环境不支持',
  });

// ===== 本地模型模式（功能热键） =====
export const getLlmMode = () =>
  safeInvoke<LlmMode>('get_llm_mode', undefined, {
    use_local_vision: false,
    local_configured: false,
    active_vision_label: '未配置',
    hotkey: 'Ctrl+Alt+L',
  });

export const toggleLocalLlm = () =>
  safeInvoke<LlmMode>('toggle_local_llm', undefined, {
    use_local_vision: false,
    local_configured: false,
    active_vision_label: '未配置',
    hotkey: 'Ctrl+Alt+L',
  });

export const onLlmModeChanged = (cb: (mode: LlmMode) => void): Promise<UnlistenFn> =>
  safeListen('llm-mode-changed', cb);

// ===== 事件 =====
export const onWatchEvent = (cb: (e: WatchEvent) => void): Promise<UnlistenFn> => safeListen('watch-event', cb);
