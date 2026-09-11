// 类型定义 - 与 Rust 后端完全对应

export interface LlmProvider {
  id: string;
  /** 显示名称；空时回退到 provider+model */
  name: string;
  provider: string;
  base_url: string;
  api_key: string;
  model: string;
  temperature: number;
  timeout: number;
}

export interface LlmConfig {
  providers: LlmProvider[];
  /** 默认文本 provider 的 id */
  default_text_id: string;
  /** 默认视觉 provider 的 id */
  default_vision_id: string;
  /** 本地模式使用的视觉 provider id（Ollama / LM Studio 等） */
  default_local_vision_id: string;
  /** true 时截图分析走本地视觉模型（热键 Ctrl+Alt+L 可切换） */
  use_local_vision: boolean;
}

export interface ScreenshotConfig {
  enabled: boolean;
  interval_seconds: number;
  keep_after_analysis: boolean;
  output_dir: string;
  auto_start: boolean;
  monitor_index: number;
  idle_skip_seconds: number;
  /** 画面与上一张几乎一致时跳过视觉分析（省 token） */
  dedup_screenshots: boolean;
}

export interface ReportConfig {
  default_template: string;
  language: string;
  user_name: string;
  team: string;
  /** 用户自定义指令：生成日报/报告时交给模型遵守 */
  custom_instructions: string;
}

export interface ProfileConfig {
  /** 希望如何称呼你（必填） */
  display_name: string;
  /** 其他称呼 */
  aliases: string;
  /** 角色与自我定位 */
  role: string;
  /** 公司、组织与岗位 */
  org: string;
  /** 当前项目、产品与业务背景 */
  projects: string;
  /** 核心职责与常见工作 */
  responsibilities: string;
  /** 团队成员与常见协作者 */
  collaborators: string;
  /** 其他长期信息 */
  extra: string;
}

export interface AppConfig {
  auto_launch_on_boot: boolean;
  silent_launch: boolean;
  cleanup_keep_days: number;
}

export interface TodoConfig {
  /** 全局快捷键：一体弹窗（输入+列表）；默认 Alt+Space；空字符串禁用 */
  hotkey: string;
  /** @deprecated 兼容旧配置 */
  quick_add_hotkey?: string | null;
  /** @deprecated 兼容旧配置 */
  list_hotkey?: string | null;
}

export interface NasConfig {
  enabled: boolean;
  /** NAS 服务端地址，例如 http://192.168.1.100:8088 */
  base_url: string;
  token: string;
  /** 设备标识；空则自动取主机名 */
  device_id: string;
  device_name: string;
  /** 同步截图原图到 NAS（单独按日期存放） */
  sync_images: boolean;
  sync_interval_seconds: number;
}

export interface GitConfig {
  enabled: boolean;
  repos: string[];
  author_emails: string[];
  author_names: string[];
  poll_interval_seconds: number;
}

export interface ShortcutConfig {
  /** 切换本地模型分析模式的全局热键；空字符串禁用 */
  local_llm_toggle: string;
}

export interface Config {
  llm: LlmConfig;
  screenshot: ScreenshotConfig;
  report: ReportConfig;
  app: AppConfig;
  todo: TodoConfig;
  nas: NasConfig;
  git: GitConfig;
  shortcuts: ShortcutConfig;
  profile: ProfileConfig;
  push: PushConfig;
  db_path: string;
}

export interface WorkLog {
  id: number;
  ts: string;
  source: string;
  category?: string;
  title: string;
  content: string;
  meta: any;
  created_at: string;
}

export interface Todo {
  id: number;
  content: string;
  /** pending | done */
  status: string;
  created_at: string;
  completed_at?: string | null;
  work_log_id?: number | null;
}

export interface Report {
  id: number;
  kind: string;
  period_start: string;
  period_end: string;
  template?: string;
  content: string;
  created_at: string;
}

export interface MonitorInfo {
  index: number;
  label: string;
  width: number;
  height: number;
}

export interface ReportTemplate {
  key: string;
  label: string;
  system_prompt: string;
  user_prompt_hint: string;
}

export type ReportKind = 'Daily' | 'Weekly' | 'Monthly';

export interface GenerateRequest {
  kind: ReportKind;
  anchor: string;
  template?: string;
  extra_notes: string;
  include_screenshots: boolean;
}

export interface GenerateResult {
  kind: string;
  period_start: string;
  period_end: string;
  template: string;
  content: string;
  commit_count: number;
  screenshot_count: number;
  todo_count?: number;
  report_id: number;
}

export interface StorageStats {
  work_logs_total: number;
  reports_total: number;
  earliest_log?: string;
  latest_log?: string;
  todos_pending?: number;
  todos_done?: number;
}

export interface PurgeStats {
  work_logs: number;
  reports: number;
}

export interface CategoryStat {
  category: string | null;
  count: number;
}

export interface DailyStat {
  day: string;
  count: number;
}

export interface SourceStat {
  source: string;
  count: number;
}

export type WatchEvent =
  | { type: 'started'; interval_seconds: number }
  | {
      type: 'captured';
      ts: string;
      category: string;
      title: string;
      summary: string;
      keywords: string[];
      app?: string;
    }
  | { type: 'failed'; message: string }
  | { type: 'idle_skipped'; idle_seconds: number }
  | { type: 'duplicate_skipped'; ts: string }
  | { type: 'stopped' };

export interface LlmMode {
  use_local_vision: boolean;
  local_configured: boolean;
  active_vision_label: string;
  hotkey: string;
}

export interface PushChannel {
  channel_type: string; // feishu | dingtalk | wecom | telegram
  webhook_url: string;
  secret: string;
  enabled: boolean;
}

export interface PushConfig {
  enabled: boolean;
  daily_time: string;
  daily_days: number[];
  weekly_enabled: boolean;
  weekly_day: number;
  channels: PushChannel[];
}

export interface PushStats {
  generated_daily: boolean;
  generated_weekly: boolean;
  report_id: number;
  weekly_report_id: number;
  deliveries: [string, boolean, string][];
}

export interface AssistantMessageRow {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}

export interface NasSyncStats {
  pushed_records: number;
  pushed_images: number;
  pushed_usage: number;
  failed: boolean;
  message: string;
}

export type ExportFormat = 'md' | 'html' | 'txt' | 'docx';

export type PlanCycleType = 'single' | 'daily' | 'weekly' | 'monthly';
export type PlanPriority = 'low' | 'medium' | 'high';
export type PlanPeriod = 'day' | 'week' | 'month' | 'year';

export interface PlanTask {
  id: number;
  title: string;
  description: string;
  start_date: string;
  end_date: string;
  start_time: string;
  end_time: string;
  cycle_type: PlanCycleType;
  priority: PlanPriority;
  tags: string;
  progress: number;
  status: 'pending' | 'in_progress' | 'completed';
  parent_id: number | null;
  period: PlanPeriod;
  created_at: string;
  updated_at: string;
}

export interface PlanTaskCreate {
  title: string;
  description?: string;
  start_date: string;
  end_date: string;
  start_time: string;
  end_time: string;
  cycle_type: PlanCycleType;
  priority: PlanPriority;
  tags: string;
  progress: number;
  status: 'pending' | 'in_progress' | 'completed';
  parent_id: number | null;
  period: PlanPeriod;
}

export interface AppUsageRecord {
  app_name: string;
  total_duration_sec: number;
  first_used_at?: string;
  last_used_at?: string;
}

export interface HeatMapRecord {
  date: string;
  hourly_counts: number[];
  focus_minutes: number;
  total_records: number;
  top_category?: string;
  active_period?: string;
}
