import { useEffect, useState, type KeyboardEvent } from 'react';
import {
  Save,
  CheckCircle2,
  FolderOpen,
  Plug,
  Trash2,
  ListTree,
  AlertTriangle,
  Cpu,
  Camera,
  FileText,
  Settings as SettingsIcon,
  Database,
  Plus,
  Info,
  HardDrive,
  RefreshCw,
  UserCog,
  ClipboardList,
  X,
  Bell,
  Send,
  Lock,
  Download,
  UploadCloud,
  Folder,
} from 'lucide-react';

import Card from '../components/Card';
import Button from '../components/Button';
import Tabs from '../components/Tabs';
import Spinner from '../components/Spinner';
import { Input, Select, Textarea } from '../components/Input';
import { save as saveDialog, open as openDialog } from '@tauri-apps/plugin-dialog';
import { openPath } from '@tauri-apps/plugin-opener';
import {
  accountChangePassword,
  accountLogin,
  accountSetEnabled,
  accountSetup,
  accountStatus,
  dataStats,
  exportData,
  importData,
  moveDataLocation,
  purgeCategory,
  restartApp,
  listTemplates,
  nasSyncNow,
  nasTestConnection,
  pushRunNow,
  openLogDir,
  purgeAll,
  purgeBefore,
  storageStats,
  testLlmConnection,
} from '../api/ipc';
import { useConfig } from '../hooks/useConfig';
import type {
  AccountStatus,
  Config,
  DataStats,
  LlmProvider,
  ReportTemplate,
  StorageStats,
} from '../api/types';
import { useToast } from '../hooks/useToast';
import dayjs from 'dayjs';

type TabKey = 'llm' | 'ai' | 'push' | 'screenshot' | 'nas' | 'report' | 'app' | 'data' | 'account' | 'about';

const SETTING_TABS = [
  { key: 'llm' as const, label: 'LLM', icon: <Cpu size={14} /> },
  { key: 'ai' as const, label: 'AI 资料', icon: <UserCog size={14} /> },
  { key: 'push' as const, label: '推送', icon: <Bell size={14} /> },
  { key: 'screenshot' as const, label: '截图', icon: <Camera size={14} /> },
  { key: 'nas' as const, label: 'NAS 同步', icon: <HardDrive size={14} /> },
  { key: 'report' as const, label: '报告', icon: <FileText size={14} /> },
  { key: 'app' as const, label: '应用', icon: <SettingsIcon size={14} /> },
  { key: 'data' as const, label: '数据', icon: <Database size={14} /> },
  { key: 'account' as const, label: '账号', icon: <Lock size={14} /> },
  { key: 'about' as const, label: '关于', icon: <Info size={14} /> },
];

export default function Settings() {
  const toast = useToast();
  const { config, save, saving, loading } = useConfig();
  const [tab, setTab] = useState<TabKey>('llm');
  const [draft, setDraft] = useState<Config | null>(null);
  const [testing, setTesting] = useState(false);
  const [stats, setStats] = useState<StorageStats | null>(null);
  // 报告模板列表（来自后端 listTemplates）
  const [templates, setTemplates] = useState<ReportTemplate[]>([]);

  // 拉取模板（一次性，挂载时）
  useEffect(() => {
    listTemplates()
      .then(setTemplates)
      .catch(() => setTemplates([]));
  }, []);
  const [purging, setPurging] = useState(false);
  const [purgeDays, setPurgeDays] = useState(30);
  // 当前选中编辑的 LLM provider id；默认选中第一个
  const [selectedProviderId, setSelectedProviderId] = useState<string>('');
  // NAS 操作状态
  const [nasTesting, setNasTesting] = useState(false);
  const [nasSyncing, setNasSyncing] = useState(false);
  // 推送测试
  const [pushTesting, setPushTesting] = useState(false);
  // 数据管理
  const [dStats, setDStats] = useState<DataStats | null>(null);
  const [purgeFiles, setPurgeFiles] = useState(true);
  const [purgingCat, setPurgingCat] = useState<string | null>(null);
  // 加密备份
  const [expPwd, setExpPwd] = useState('');
  const [impPwd, setImpPwd] = useState('');
  const [backupBusy, setBackupBusy] = useState<'export' | 'import' | null>(null);
  // 账号
  const [acct, setAcct] = useState<AccountStatus | null>(null);
  const [acctUser, setAcctUser] = useState('');
  const [acctNewPwd, setAcctNewPwd] = useState('');
  const [acctNewPwd2, setAcctNewPwd2] = useState('');
  const [acctOldPwd, setAcctOldPwd] = useState('');
  const [acctTogglePwd, setAcctTogglePwd] = useState('');
  const [acctBusy, setAcctBusy] = useState(false);
  // AI 资料弹窗
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [showCustomModal, setShowCustomModal] = useState(false);
  const [profileDraft, setProfileDraft] = useState<Config['profile'] | null>(null);
  const [customDraft, setCustomDraft] = useState('');

  // draft 加载后，若已有 providers 而未选中任何项，自动选第一个
  useEffect(() => {
    if (!draft) return;
    const list = draft.llm.providers ?? [];
    if (selectedProviderId && list.some((p) => p.id === selectedProviderId)) return;
    setSelectedProviderId(list[0]?.id ?? '');
  }, [draft, selectedProviderId]);

  useEffect(() => {
    if (config) setDraft(structuredClone(config));
  }, [config]);

  const refreshStats = async () => {
    try {
      const s = await storageStats();
      setStats(s);
    } catch (e: any) {
      console.warn('storage_stats failed', e);
    }
  };

  useEffect(() => {
    void refreshStats();
  }, []);

  const refreshDataStats = async () => {
    try {
      setDStats(await dataStats());
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    if (tab === 'data') void refreshDataStats();
  }, [tab]);

  useEffect(() => {
    void accountStatus().then(setAcct).catch(() => {});
  }, []);

  const fmtBytes = (n: number) => {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(1)} MB`;
  };

  const onPurgeCategory = async (category: string, label: string, keepDays: number | null) => {
    if (!confirm(`确认清理「${label}」${keepDays ? `${keepDays} 天前的` : '全部'}数据？不可恢复。`)) return;
    setPurgingCat(category);
    try {
      const r = await purgeCategory(category, keepDays, purgeFiles && category === 'work_logs');
      toast.success(
        `已清理：${r.deleted_rows} 条记录${r.deleted_files > 0 ? `、${r.deleted_files} 个截图文件` : ''}`
      );
      await refreshDataStats();
      await refreshStats();
    } catch (e: any) {
      toast.error(`清理失败: ${e}`);
    } finally {
      setPurgingCat(null);
    }
  };

  const [moving, setMoving] = useState(false);

  const onMoveData = async () => {
    try {
      const dir = await openDialog({ directory: true, title: '选择新的数据保存目录' });
      if (!dir || typeof dir !== 'string') return;
      if (
        !confirm(
          `将把数据库和全部截图复制到：\n${dir}\n\n并更新配置（旧目录文件保留）。确认继续？`
        )
      )
        return;
      setMoving(true);
      const msg = await moveDataLocation(dir);
      toast.success(String(msg));
      if (confirm('迁移完成，现在重启应用使新位置生效吗？')) {
        await restartApp();
      }
      await refreshDataStats();
    } catch (e: any) {
      toast.error(`迁移失败: ${e}`);
    } finally {
      setMoving(false);
    }
  };

  const onExport = async () => {
    if (!expPwd) {
      toast.error('请先设置导出密码');
      return;
    }
    try {
      const path = await saveDialog({
        defaultPath: `日报助手备份-${dayjs().format('YYYYMMDD-HHmmss')}.dabak`,
        filters: [{ name: '加密备份', extensions: ['dabak'] }],
      });
      if (!path || typeof path !== 'string') return;
      setBackupBusy('export');
      const size = await exportData(path, expPwd);
      toast.success(`已导出加密备份（${fmtBytes(size)}），密码请妥善保管`);
      setExpPwd('');
    } catch (e: any) {
      toast.error(`导出失败: ${e}`);
    } finally {
      setBackupBusy(null);
    }
  };

  const onImport = async () => {
    if (!impPwd) {
      toast.error('请先输入备份密码');
      return;
    }
    try {
      const path = await openDialog({
        multiple: false,
        filters: [{ name: '加密备份', extensions: ['dabak'] }],
      });
      if (!path || typeof path !== 'string') return;
      if (!confirm('导入将覆盖当前全部数据（账号保留），确认继续？')) return;
      setBackupBusy('import');
      const msg = await importData(path, impPwd);
      toast.success(`${msg}`);
      if (
        confirm('数据将在重启后完成恢复。现在重启应用吗？')
      ) {
        await restartApp();
      }
      setImpPwd('');
    } catch (e: any) {
      toast.error(`导入失败: ${e}`);
    } finally {
      setBackupBusy(null);
    }
  };

  if (loading || !draft) {
    return (
      <div className="p-6 text-sm text-ink2 flex items-center gap-2">
        <Spinner size={4} /> 加载配置中...
      </div>
    );
  }

  const onSave = async () => {
    try {
      await save(draft);
      toast.success('已保存');
    } catch (e: any) {
      toast.error(`保存失败: ${e}`);
    }
  };

  // 当前选中的 LLM provider 草稿；用于编辑面板
  const selectedProvider: LlmProvider | null =
    draft?.llm.providers.find((p) => p.id === selectedProviderId) ?? null;

  const onTest = async () => {
    if (!selectedProvider) {
      toast.error('请先选中要测试的 provider');
      return;
    }
    if (testing) return;
    setTesting(true);
    try {
      const [ok, msg] = await testLlmConnection(selectedProvider);
      if (ok) toast.success(`连接成功：${msg || ''}`);
      else toast.error(`连接失败：${msg}`);
    } catch (e: any) {
      toast.error(`测试失败: ${e}`);
    } finally {
      setTesting(false);
    }
  };

  /** 生成简单短随机 id，避免依赖 crypto.randomUUID 在低版本 webview 不可用 */
  const genProviderId = () => 'p-' + Math.random().toString(36).slice(2, 10);

  /** 添加新 provider；template 决定预填字段。返回新 id 以便选中。 */
  const addProvider = (template: 'openai' | 'openai-vision' | 'claude' | 'deepseek' | 'qwencloud' | 'local-ollama' | 'custom') => {
    if (!draft) return;
    const id = genProviderId();
    let fresh: LlmProvider;
    switch (template) {
      case 'openai':
        fresh = {
          id,
          name: 'OpenAI',
          provider: 'openai',
          base_url: 'https://api.openai.com/v1',
          api_key: '',
          model: 'gpt-4o-mini',
          temperature: 0.4,
          timeout: 60,
        };
        break;
      case 'openai-vision':
        fresh = {
          id,
          name: 'OpenAI (视觉)',
          provider: 'openai',
          base_url: 'https://api.openai.com/v1',
          api_key: '',
          model: 'gpt-4o',
          temperature: 0.4,
          timeout: 60,
        };
        break;
      case 'claude':
        fresh = {
          id,
          name: 'Claude',
          provider: 'anthropic',
          base_url: 'https://api.anthropic.com/v1',
          api_key: '',
          model: 'claude-3-5-sonnet-latest',
          temperature: 0.4,
          timeout: 60,
        };
        break;
      case 'deepseek':
        fresh = {
          id,
          name: 'DeepSeek (文本)',
          provider: 'deepseek',
          base_url: 'https://api.deepseek.com/v1',
          api_key: '',
          model: 'deepseek-v4-flash',
          temperature: 0.4,
          timeout: 60,
        };
        break;
      case 'qwencloud':
        fresh = {
          id,
          name: 'QwenCloud (视觉)',
          provider: 'openai',
          base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
          api_key: '',
          model: 'qwen3.7-plus',
          temperature: 0.4,
          timeout: 60,
        };
        break;
      case 'local-ollama':
        fresh = {
          id,
          name: '本地模型 (Ollama)',
          provider: 'ollama',
          base_url: 'http://127.0.0.1:11434/v1',
          api_key: 'ollama',
          model: 'qwen2.5-vl:7b',
          temperature: 0.4,
          timeout: 120,
        };
        break;
      default:
        fresh = {
          id,
          name: '',
          provider: 'openai',
          base_url: '',
          api_key: '',
          model: '',
          temperature: 0.4,
          timeout: 60,
        };
    }
    const next: Config = {
      ...draft,
      llm: {
        ...draft.llm,
        providers: [...draft.llm.providers, fresh],
        // 第一条添加时自动设为默认
        default_text_id: draft.llm.default_text_id || id,
        default_vision_id: draft.llm.default_vision_id || id,
      },
    };
    setDraft(next);
    setSelectedProviderId(id);
  };

  const updateProvider = (id: string, patch: Partial<LlmProvider>) => {
    if (!draft) return;
    const next: Config = {
      ...draft,
      llm: {
        ...draft.llm,
        providers: draft.llm.providers.map((p) =>
          p.id === id ? { ...p, ...patch } : p
        ),
      },
    };
    setDraft(next);
  };

  const removeProvider = (id: string) => {
    if (!draft) return;
    const list = draft.llm.providers.filter((p) => p.id !== id);
    const next: Config = {
      ...draft,
      llm: {
        ...draft.llm,
        providers: list,
        default_text_id:
          draft.llm.default_text_id === id ? '' : draft.llm.default_text_id,
        default_vision_id:
          draft.llm.default_vision_id === id ? '' : draft.llm.default_vision_id,
      },
    };
    setDraft(next);
    if (selectedProviderId === id) {
      setSelectedProviderId(list[0]?.id ?? '');
    }
  };

  const onOpenLogDir = async () => {
    try {
      await openLogDir();
    } catch (e: any) {
      toast.error(`打开日志目录失败: ${e}`);
    }
  };

  const onPurgeBefore = async () => {
    if (!confirm(`将清理 ${purgeDays} 天之前的所有工作流水与报告，是否继续？`))
      return;
    setPurging(true);
    try {
      const r = await purgeBefore(purgeDays);
      toast.success(`已清理：流水 ${r.work_logs} 条，报告 ${r.reports} 条`);
      await refreshStats();
    } catch (e: any) {
      toast.error(`清理失败: ${e}`);
    } finally {
      setPurging(false);
    }
  };

  const onPurgeAll = async () => {
    if (
      !confirm(
        '⚠ 危险操作：将清空所有工作流水与历史报告，且无法恢复。是否确认？'
      )
    )
      return;
    setPurging(true);
    try {
      const r = await purgeAll();
      toast.success(`已清空：流水 ${r.work_logs} 条，报告 ${r.reports} 条`);
      await refreshStats();
    } catch (e: any) {
      toast.error(`清空失败: ${e}`);
    } finally {
      setPurging(false);
    }
  };

  const update = <K extends keyof Config>(key: K, value: Config[K]) =>
    setDraft((d) => (d ? { ...d, [key]: value } : d));

  /** NAS 测试连接：先保存草稿（测试读的是已保存配置），再测 */
  const onNasTest = async () => {
    if (!draft) return;
    setNasTesting(true);
    try {
      await save(draft);
      const [ok, msg] = await nasTestConnection();
      if (ok) toast.success(`NAS 连接成功：${msg}`);
      else toast.error(`NAS 连接失败：${msg}`);
    } catch (e: any) {
      toast.error(`测试失败: ${e}`);
    } finally {
      setNasTesting(false);
    }
  };

  /** 立即同步：先保存草稿，再触发一轮增量同步 */
  const onNasSync = async () => {
    if (!draft) return;
    setNasSyncing(true);
    try {
      await save(draft);
      const r = await nasSyncNow();
      if (r.failed) {
        toast.error(`同步失败：${r.message || '未知错误'}`);
      } else {
        toast.success(
          `同步完成：记录 ${r.pushed_records} 条、图片 ${r.pushed_images} 张、应用时长 ${r.pushed_usage} 条`
        );
      }
    } catch (e: any) {
      toast.error(`同步失败: ${e}`);
    } finally {
      setNasSyncing(false);
    }
  };

  return (
    <div className="p-6 space-y-5 pb-24">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-ink text-pix">设置</h1>
          <p className="text-sm text-ink2 mt-1">
            配置 LLM、截图、报告与应用行为
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* 顶部按钮统一 md 尺寸，保证视觉等高 */}
          <Button
            variant="ghost"
            size="md"
            icon={<FolderOpen size={14} />}
            onClick={() => void onOpenLogDir()}
          >
            打开日志目录
          </Button>
          <Button
            size="md"
            icon={<Save size={14} />}
            onClick={() => void onSave()}
            loading={saving}
          >
            保存配置
          </Button>
        </div>
      </header>

      {/* 设置 Tabs */}
      <Tabs tabs={SETTING_TABS} value={tab} onChange={setTab} />

      <div key={tab} className="animate-fadein">
        {/* LLM */}
        {tab === 'llm' && (
          <Card
            title="LLM 配置"
            description="管理多个大模型 provider，可分别指定默认文本模型与视觉模型"
            hoverable={false}
          >
            {/* 顶部：添加按钮 */}
            <div className="flex items-center justify-between mb-3">
              <label className="text-sm font-medium text-ink">Providers</label>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<Plus size={14} />}
                  onClick={() => addProvider('openai')}
                >
                  添加 OpenAI
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<Plus size={14} />}
                  onClick={() => addProvider('openai-vision')}
                >
                  OpenAI (视觉)
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<Plus size={14} />}
                  onClick={() => addProvider('claude')}
                >
                  添加 Claude
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<Plus size={14} />}
                  onClick={() => addProvider('deepseek')}
                >
                  DeepSeek (文本)
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<Plus size={14} />}
                  onClick={() => addProvider('qwencloud')}
                >
                  QwenCloud (视觉)
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<Plus size={14} />}
                  onClick={() => addProvider('custom')}
                >
                  自定义
                </Button>
              </div>
            </div>

            {/* providers 列表 */}
            <div className="border border-border rounded-md divide-y divide-border bg-card mb-4">
              {draft.llm.providers.length === 0 ? (
                <div className="px-3 py-6 text-sm text-ink2 text-center">
                  尚未添加任何 provider。点击右上方按钮选择模板新建一个。
                </div>
              ) : (
                draft.llm.providers.map((p) => {
                  const isSelected = p.id === selectedProviderId;
                  const isText = p.id === draft.llm.default_text_id;
                  const isVision = p.id === draft.llm.default_vision_id;
                  return (
                    <div
                      key={p.id}
                      onClick={() => setSelectedProviderId(p.id)}
                      className={`flex items-center gap-2 px-3 py-2 cursor-pointer group ${
                        isSelected ? 'bg-primary-50' : 'hover:bg-bg'
                      }`}
                    >
                      <Cpu
                        size={14}
                        className={
                          isSelected ? 'text-primary-700' : 'text-ink2'
                        }
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-ink truncate">
                          {p.name?.trim()
                            ? p.name
                            : `${p.provider || '未命名'} · ${p.model || '未填模型'}`}
                        </div>
                        <div className="text-[11px] text-ink2 truncate">
                          {p.provider} · {p.model || '未填模型'} · {p.base_url || '未填 base_url'}
                        </div>
                      </div>
                      {isText && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary-100 text-primary-700">
                          文本默认
                        </span>
                      )}
                      {isVision && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent-100 text-accent-700">
                          视觉默认
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeProvider(p.id);
                        }}
                        className="text-ink2 hover:text-red-500 px-1 opacity-0 group-hover:opacity-100 transition-opacity"
                        aria-label="移除"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  );
                })
              )}
            </div>

            {/* 编辑面板 */}
            {selectedProvider ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Input
                  label="显示名称"
                  value={selectedProvider.name}
                  onChange={(e) =>
                    updateProvider(selectedProvider.id, { name: e.target.value })
                  }
                  placeholder="用于在列表中识别这条 provider"
                />
                <ProviderSelect
                  value={selectedProvider.provider}
                  onChange={(v) =>
                    updateProvider(selectedProvider.id, { provider: v })
                  }
                />
                <Input
                  label="Base URL"
                  value={selectedProvider.base_url}
                  onChange={(e) =>
                    updateProvider(selectedProvider.id, {
                      base_url: e.target.value.trim().replace(".com.com", ".com").replace(".ai.ai", ".ai").replace(".net.net", ".net").trimEnd(),
                    })
                  }
                  placeholder="https://api.openai.com/v1"
                  hint="注意：不要输入重复的域名后缀（如 .com.com）"
                />
                <Input
                  label="API Key"
                  type="password"
                  value={selectedProvider.api_key}
                  onChange={(e) =>
                    updateProvider(selectedProvider.id, {
                      api_key: e.target.value,
                    })
                  }
                  placeholder="sk-..."
                />
                <Input
                  label="模型"
                  value={selectedProvider.model}
                  onChange={(e) =>
                    updateProvider(selectedProvider.id, {
                      model: e.target.value,
                    })
                  }
                  placeholder="gpt-4o-mini / claude-3-5-sonnet-latest"
                />
                <Input
                  label="Temperature"
                  type="number"
                  step="0.1"
                  min="0"
                  max="2"
                  value={selectedProvider.temperature}
                  onChange={(e) =>
                    updateProvider(selectedProvider.id, {
                      temperature: Number(e.target.value),
                    })
                  }
                />
                <Input
                  label="超时（秒）"
                  type="number"
                  min="1"
                  value={selectedProvider.timeout}
                  onChange={(e) =>
                    updateProvider(selectedProvider.id, {
                      timeout: Number(e.target.value),
                    })
                  }
                />
              </div>
            ) : null}

            {/* 默认选择 + 测试按钮 */}
            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
              <Select
                label="默认文本模型"
                value={draft.llm.default_text_id}
                onChange={(e) =>
                  update('llm', { ...draft.llm, default_text_id: e.target.value })
                }
              >
                <option value="">— 未指定 —</option>
                {draft.llm.providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name?.trim() ? p.name : `${p.provider} · ${p.model}`}
                  </option>
                ))}
              </Select>
              <Select
                label="默认视觉模型"
                value={draft.llm.default_vision_id}
                onChange={(e) =>
                  update('llm', {
                    ...draft.llm,
                    default_vision_id: e.target.value,
                  })
                }
              >
                <option value="">— 未指定 —</option>
                {draft.llm.providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name?.trim() ? p.name : `${p.provider} · ${p.model}`}
                  </option>
                ))}
              </Select>
              <Select
                label="本地视觉模型（功能热键切换用）"
                value={draft.llm.default_local_vision_id ?? ''}
                onChange={(e) =>
                  update('llm', {
                    ...draft.llm,
                    default_local_vision_id: e.target.value,
                  })
                }
                hint="添加一条 Ollama / LM Studio 等 provider 并在此指定，用 Ctrl+Alt+L 一键切换到本地分析"
              >
                <option value="">— 未指定 —</option>
                {draft.llm.providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name?.trim() ? p.name : `${p.provider} · ${p.model}`}
                  </option>
                ))}
              </Select>
              <label className="flex items-center gap-2 text-sm self-end pb-2 text-ink">
                <input
                  type="checkbox"
                  checked={draft.llm.use_local_vision ?? false}
                  onChange={(e) =>
                    update('llm', {
                      ...draft.llm,
                      use_local_vision: e.target.checked,
                    })
                  }
                  className="accent-primary"
                />
                当前使用本地模型分析（监听下一轮生效）
              </label>
            </div>

            <div className="mt-3">
              <Button
                variant="secondary"
                size="sm"
                icon={<Plus size={14} />}
                onClick={() => addProvider('local-ollama')}
              >
                添加 Ollama 本地模型
              </Button>
            </div>

            <div className="mt-3">
              <Button
                variant="secondary"
                size="sm"
                icon={<Plug size={14} />}
                onClick={() => void onTest()}
                loading={testing}
                disabled={!selectedProvider}
              >
                测试当前 provider
              </Button>
            </div>
          </Card>
        )}

        {/* AI 资料 */}
        {tab === 'ai' && (
          <>
            <Card
              title="我的资料"
              description="只由你主动维护，用于帮助 AI 理解你的人名、组织、项目和长期工作背景；保存在本地，只会在相关 AI 功能中按需使用"
              hoverable={false}
            >
              {(() => {
                const pf = draft.profile;
                const items: [string, string][] = [
                  ['希望如何称呼你', pf?.display_name ?? ''],
                  ['其他称呼', pf?.aliases ?? ''],
                  ['角色与自我定位', pf?.role ?? ''],
                  ['公司、组织与岗位', pf?.org ?? ''],
                  ['当前项目、产品与业务背景', pf?.projects ?? ''],
                  ['核心职责与常见工作', pf?.responsibilities ?? ''],
                  ['团队成员与常见协作者', pf?.collaborators ?? ''],
                  ['其他长期信息', pf?.extra ?? ''],
                ];
                const filled = items.filter(([, v]) => v.trim());
                return (
                  <>
                    {filled.length === 0 ? (
                      <div className="text-sm text-ink2 py-2">
                        还没有填写资料。填写后 AI 生成报告和规划对话会更懂你。
                      </div>
                    ) : (
                      <div className="space-y-1.5 mb-3">
                        {filled.map(([k, v]) => (
                          <div key={k} className="text-sm flex gap-2">
                            <span className="text-ink2 w-44 shrink-0">{k}</span>
                            <span className="text-ink break-all">{v}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    <Button
                      variant="secondary"
                      size="sm"
                      icon={<UserCog size={14} />}
                      onClick={() => {
                        setProfileDraft(
                          structuredClone(draft.profile ?? {
                            display_name: '', aliases: '', role: '', org: '',
                            projects: '', responsibilities: '', collaborators: '', extra: '',
                          })
                        );
                        setShowProfileModal(true);
                      }}
                    >
                      {filled.length === 0 ? '填写我的资料' : '编辑我的资料'}
                    </Button>
                  </>
                );
              })()}
            </Card>

            <Card
              title="自定义指令"
              description="生成日报或报告时交给模型遵循：输出格式、内容取舍、表达风格、需要排除的记录或其他特殊要求；不填则由 AI 根据模板和工作记录自动组织内容"
              hoverable={false}
            >
              {draft.report.custom_instructions?.trim() ? (
                <div className="bg-bg/50 border border-border rounded-pix p-3 text-sm text-ink whitespace-pre-wrap mb-3 line-clamp-6">
                  {draft.report.custom_instructions}
                </div>
              ) : (
                <div className="text-sm text-ink2 py-2 mb-3">
                  未设置。例如：按 Markdown 输出；重点突出项目成果和风险；弱化闲聊等无关记录；语气简洁、适合发给领导。
                </div>
              )}
              <Button
                variant="secondary"
                size="sm"
                icon={<ClipboardList size={14} />}
                onClick={() => {
                  setCustomDraft(draft.report.custom_instructions ?? '');
                  setShowCustomModal(true);
                }}
              >
                {draft.report.custom_instructions?.trim() ? '编辑指令' : '设置指令'}
              </Button>
            </Card>
          </>
        )}

        {/* Screenshot */}
        {tab === 'screenshot' && (
          <Card title="截图" description="周期截图与视觉理解" hoverable={false}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Input
                label="间隔（秒）"
                type="number"
                min="10"
                value={draft.screenshot.interval_seconds}
                onChange={(e) =>
                  update('screenshot', {
                    ...draft.screenshot,
                    interval_seconds: Number(e.target.value),
                  })
                }
              />
              <Input
                label="空闲跳过（秒，0 关闭）"
                type="number"
                min="0"
                value={draft.screenshot.idle_skip_seconds}
                onChange={(e) =>
                  update('screenshot', {
                    ...draft.screenshot,
                    idle_skip_seconds: Number(e.target.value),
                  })
                }
              />
              <Input
                label="显示器索引"
                type="number"
                min="0"
                value={draft.screenshot.monitor_index}
                onChange={(e) =>
                  update('screenshot', {
                    ...draft.screenshot,
                    monitor_index: Number(e.target.value),
                  })
                }
                hint="0 表示主显示器"
              />
              <Input
                label="输出目录"
                value={draft.screenshot.output_dir}
                onChange={(e) =>
                  update('screenshot', {
                    ...draft.screenshot,
                    output_dir: e.target.value,
                  })
                }
                placeholder="留空使用默认"
              />
              <label className="flex items-center gap-2 text-sm self-end pb-2 text-ink">
                <input
                  type="checkbox"
                  checked={draft.screenshot.enabled}
                  onChange={(e) =>
                    update('screenshot', {
                      ...draft.screenshot,
                      enabled: e.target.checked,
                    })
                  }
                  className="accent-primary"
                />
                启用截图
              </label>
              <label className="flex items-center gap-2 text-sm self-end pb-2 text-ink">
                <input
                  type="checkbox"
                  checked={draft.screenshot.auto_start}
                  onChange={(e) =>
                    update('screenshot', {
                      ...draft.screenshot,
                      auto_start: e.target.checked,
                    })
                  }
                  className="accent-primary"
                />
                启动时自动开始监听
              </label>
              <label className="flex items-center gap-2 text-sm self-end pb-2 md:col-span-2 text-ink">
                <input
                  type="checkbox"
                  checked={draft.screenshot.keep_after_analysis}
                  onChange={(e) =>
                    update('screenshot', {
                      ...draft.screenshot,
                      keep_after_analysis: e.target.checked,
                    })
                  }
                  className="accent-primary"
                />
                分析后保留图片文件
              </label>
              <label className="flex items-center gap-2 text-sm self-end pb-2 md:col-span-2 text-ink">
                <input
                  type="checkbox"
                  checked={draft.screenshot.dedup_screenshots ?? true}
                  onChange={(e) =>
                    update('screenshot', {
                      ...draft.screenshot,
                      dedup_screenshots: e.target.checked,
                    })
                  }
                  className="accent-primary"
                />
                画面未变化时跳过分析（内容去重，显著节省 token）
              </label>
            </div>
          </Card>
        )}

        {/* 推送 */}
        {tab === 'push' && (
          <>
            <Card
              title="定时推送"
              description="到点自动生成日报（周报日附带周报）并推送到下面的渠道；电脑需处于开机状态"
              hoverable={false}
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <label className="flex items-center gap-2 text-sm self-end pb-2 text-ink">
                  <input
                    type="checkbox"
                    checked={draft.push?.enabled ?? false}
                    onChange={(e) =>
                      update('push', {
                        ...(draft.push ?? { enabled: false, daily_time: '18:30', daily_days: [1,2,3,4,5], weekly_enabled: false, weekly_day: 5, channels: [] }),
                        enabled: e.target.checked,
                      })
                    }
                    className="accent-primary"
                  />
                  启用定时推送
                </label>
                <Input
                  label="推送时间"
                  type="time"
                  value={draft.push?.daily_time ?? '18:30'}
                  onChange={(e) =>
                    update('push', {
                      ...(draft.push ?? { enabled: false, daily_time: '18:30', daily_days: [1,2,3,4,5], weekly_enabled: false, weekly_day: 5, channels: [] }),
                      daily_time: e.target.value,
                    })
                  }
                />
                <div className="space-y-1.5">
                  <label className="label">日报推送日</label>
                  <div className="flex items-center gap-2 flex-wrap pt-1">
                    {['一','二','三','四','五','六','日'].map((d, i) => {
                      const day = i + 1;
                      const active = (draft.push?.daily_days ?? []).includes(day);
                      return (
                        <button
                          key={day}
                          type="button"
                          onClick={() => {
                            const cur = draft.push?.daily_days ?? [];
                            const next = active ? cur.filter((x) => x !== day) : [...cur, day].sort();
                            update('push', {
                              ...(draft.push ?? { enabled: false, daily_time: '18:30', daily_days: [1,2,3,4,5], weekly_enabled: false, weekly_day: 5, channels: [] }),
                              daily_days: next,
                            });
                          }}
                          className={
                            'w-8 h-8 rounded-pix text-xs border transition-colors ' +
                            (active ? 'bg-primary text-white border-primary' : 'bg-bg text-ink2 border-border hover:border-primary-300')
                          }
                        >
                          {d}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="label flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={draft.push?.weekly_enabled ?? false}
                      onChange={(e) =>
                        update('push', {
                          ...(draft.push ?? { enabled: false, daily_time: '18:30', daily_days: [1,2,3,4,5], weekly_enabled: false, weekly_day: 5, channels: [] }),
                          weekly_enabled: e.target.checked,
                        })
                      }
                      className="accent-primary"
                    />
                    同时推送周报（每周）
                  </label>
                  <Select
                    value={String(draft.push?.weekly_day ?? 5)}
                    onChange={(e) =>
                      update('push', {
                        ...(draft.push ?? { enabled: false, daily_time: '18:30', daily_days: [1,2,3,4,5], weekly_enabled: false, weekly_day: 5, channels: [] }),
                        weekly_day: Number(e.target.value),
                      })
                    }
                  >
                    {[1,2,3,4,5,6,7].map((d) => (
                      <option key={d} value={d}>周{['一','二','三','四','五','六','日'][d-1]}</option>
                    ))}
                  </Select>
                </div>
              </div>
              <div className="mt-4">
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<Send size={14} />}
                  loading={pushTesting}
                  onClick={async () => {
                    setPushTesting(true);
                    try {
                      await save(draft);
                      const st = await pushRunNow(true);
                      const ok = st.deliveries.filter(([, ok2]) => ok2).length;
                      const fail = st.deliveries.length - ok;
                      if (st.deliveries.length === 0) {
                        toast.error('没有启用的推送渠道，请先添加渠道');
                      } else if (fail === 0) {
                        toast.success(`推送成功（${ok} 个渠道），报告已存入报告库`);
                      } else {
                        const detail = st.deliveries.map(([c, o, m]) => `${c}: ${o ? 'OK' : m}`).join('\n');
                        toast.alert(`成功 ${ok} / 失败 ${fail}\n${detail}`, { title: '推送结果', kind: fail > 0 ? 'error' : 'success' });
                      }
                    } catch (e: any) {
                      toast.error(`推送失败: ${e}`);
                    } finally {
                      setPushTesting(false);
                    }
                  }}
                >
                  保存并立即推送（测试）
                </Button>
              </div>
            </Card>

            <Card
              title="推送渠道"
              description="支持飞书 / 钉钉 / 企业微信群机器人（Webhook），以及 Telegram Bot"
              hoverable={false}
            >
              {(draft.push?.channels ?? []).length === 0 ? (
                <div className="text-sm text-ink2 py-2 mb-2">还没有渠道，点下方按钮添加。</div>
              ) : (
                <div className="space-y-3 mb-3">
                  {(draft.push?.channels ?? []).map((ch, idx) => (
                    <div key={idx} className="border border-border rounded-pix p-3 space-y-2 bg-bg/30">
                      <div className="flex items-center gap-2">
                        <Select
                          value={ch.channel_type}
                          onChange={(e) => {
                            const channels = [...(draft.push?.channels ?? [])];
                            channels[idx] = { ...ch, channel_type: e.target.value };
                            update('push', { ...(draft.push ?? { enabled: false, daily_time: '18:30', daily_days: [1,2,3,4,5], weekly_enabled: false, weekly_day: 5, channels: [] }), channels });
                          }}
                          className="w-40"
                        >
                          <option value="feishu">飞书机器人</option>
                          <option value="dingtalk">钉钉机器人</option>
                          <option value="wecom">企业微信机器人</option>
                          <option value="telegram">Telegram Bot</option>
                        </Select>
                        <label className="flex items-center gap-1.5 text-sm text-ink ml-2">
                          <input
                            type="checkbox"
                            checked={ch.enabled}
                            onChange={(e) => {
                              const channels = [...(draft.push?.channels ?? [])];
                              channels[idx] = { ...ch, enabled: e.target.checked };
                              update('push', { ...(draft.push ?? { enabled: false, daily_time: '18:30', daily_days: [1,2,3,4,5], weekly_enabled: false, weekly_day: 5, channels: [] }), channels });
                            }}
                            className="accent-primary"
                          />
                          启用
                        </label>
                        <div className="flex-1" />
                        <Button
                          variant="ghost"
                          size="sm"
                          icon={<Trash2 size={14} />}
                          onClick={() => {
                            const channels = (draft.push?.channels ?? []).filter((_, i) => i !== idx);
                            update('push', { ...(draft.push ?? { enabled: false, daily_time: '18:30', daily_days: [1,2,3,4,5], weekly_enabled: false, weekly_day: 5, channels: [] }), channels });
                          }}
                        >
                          删除
                        </Button>
                      </div>
                      <Input
                        label="Webhook 地址"
                        value={ch.webhook_url}
                        onChange={(e) => {
                          const channels = [...(draft.push?.channels ?? [])];
                          channels[idx] = { ...ch, webhook_url: e.target.value };
                          update('push', { ...(draft.push ?? { enabled: false, daily_time: '18:30', daily_days: [1,2,3,4,5], weekly_enabled: false, weekly_day: 5, channels: [] }), channels });
                        }}
                        placeholder={
                          ch.channel_type === 'telegram'
                            ? 'https://api.telegram.org/bot<TOKEN>/sendMessage'
                            : 'https://open.feishu.cn/open-apis/bot/v2/hook/...'
                        }
                      />
                      <Input
                        label={ch.channel_type === 'telegram' ? 'chat_id（Telegram 专用）' : '加签密钥（可选；钉钉设置「加签」时必填）'}
                        type="password"
                        value={ch.secret}
                        onChange={(e) => {
                          const channels = [...(draft.push?.channels ?? [])];
                          channels[idx] = { ...ch, secret: e.target.value };
                          update('push', { ...(draft.push ?? { enabled: false, daily_time: '18:30', daily_days: [1,2,3,4,5], weekly_enabled: false, weekly_day: 5, channels: [] }), channels });
                        }}
                        placeholder={ch.channel_type === 'telegram' ? 'Telegram chat_id' : 'SEC...（钉钉加签）'}
                      />
                    </div>
                  ))}
                </div>
              )}
              <Button
                variant="secondary"
                size="sm"
                icon={<Plus size={14} />}
                onClick={() => {
                  const channels = [
                    ...(draft.push?.channels ?? []),
                    { channel_type: 'feishu', webhook_url: '', secret: '', enabled: true },
                  ];
                  update('push', { ...(draft.push ?? { enabled: false, daily_time: '18:30', daily_days: [1,2,3,4,5], weekly_enabled: false, weekly_day: 5, channels: [] }), channels });
                }}
              >
                添加渠道
              </Button>
            </Card>

            <Card title="如何获取 Webhook" hoverable={false} bordered={false}>
              <div className="text-sm text-ink3 space-y-2">
                <p>• <strong>飞书</strong>：群设置 → 群机器人 → 添加「自定义机器人」→ 复制 Webhook 地址（勾选签名校验则把密钥填到加签字段）</p>
                <p>• <strong>钉钉</strong>：群设置 → 机器人 → 添加「自定义」→ 安全设置选「加签」→ 复制 Webhook + SEC 密钥</p>
                <p>• <strong>企业微信</strong>：群右键 → 添加群机器人 → 复制 Webhook 地址</p>
                <p>• <strong>Telegram</strong>：@BotFather 建 bot 拿 token；Webhook 填 https://api.telegram.org/bot&lt;TOKEN&gt;/sendMessage，chat_id 填在密钥字段</p>
                <p>• 推送的报告会同时存入「报告」页，可随时导出 Word</p>
              </div>
            </Card>
          </>
        )}

        {/* NAS */}
        {tab === 'nas' && (
          <>
            <Card
              title="NAS 数据同步"
              description="把本地工作记录与截图原图增量推送到 NAS 服务端（nas-server 目录提供部署包）"
              hoverable={false}
              footer={
                <div className="flex items-center gap-2 flex-wrap text-xs text-ink2">
                  <AlertTriangle size={12} />
                  截图原图单独存放在 NAS 的 images/ 按日期目录，不与数据库混存
                </div>
              }
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <label className="flex items-center gap-2 text-sm self-end pb-2 text-ink">
                  <input
                    type="checkbox"
                    checked={draft.nas?.enabled ?? false}
                    onChange={(e) =>
                      update('nas', {
                        ...(draft.nas ?? { enabled: false, base_url: '', token: '', device_id: '', device_name: '', sync_images: true, sync_interval_seconds: 30 }),
                        enabled: e.target.checked,
                      })
                    }
                    className="accent-primary"
                  />
                  启用 NAS 同步
                </label>
                <Input
                  label="同步周期（秒，最小 10）"
                  type="number"
                  min="10"
                  value={draft.nas?.sync_interval_seconds ?? 30}
                  onChange={(e) =>
                    update('nas', {
                      ...(draft.nas ?? { enabled: false, base_url: '', token: '', device_id: '', device_name: '', sync_images: true, sync_interval_seconds: 30 }),
                      sync_interval_seconds: Number(e.target.value),
                    })
                  }
                />
                <Input
                  label="服务端地址"
                  value={draft.nas?.base_url ?? ''}
                  onChange={(e) =>
                    update('nas', {
                      ...(draft.nas ?? { enabled: false, base_url: '', token: '', device_id: '', device_name: '', sync_images: true, sync_interval_seconds: 30 }),
                      base_url: e.target.value,
                    })
                  }
                  placeholder="http://192.168.1.100:8088"
                  hint="NAS 的 IP + 服务端口"
                />
                <Input
                  label="访问令牌"
                  type="password"
                  value={draft.nas?.token ?? ''}
                  onChange={(e) =>
                    update('nas', {
                      ...(draft.nas ?? { enabled: false, base_url: '', token: '', device_id: '', device_name: '', sync_images: true, sync_interval_seconds: 30 }),
                      token: e.target.value,
                    })
                  }
                  placeholder="与服务端 TOKEN 一致；留空表示不鉴权"
                />
                <Input
                  label="设备 ID"
                  value={draft.nas?.device_id ?? ''}
                  onChange={(e) =>
                    update('nas', {
                      ...(draft.nas ?? { enabled: false, base_url: '', token: '', device_id: '', device_name: '', sync_images: true, sync_interval_seconds: 30 }),
                      device_id: e.target.value,
                    })
                  }
                  placeholder="留空自动取主机名"
                  hint="多台电脑同步时用于区分来源"
                />
                <Input
                  label="设备名称"
                  value={draft.nas?.device_name ?? ''}
                  onChange={(e) =>
                    update('nas', {
                      ...(draft.nas ?? { enabled: false, base_url: '', token: '', device_id: '', device_name: '', sync_images: true, sync_interval_seconds: 30 }),
                      device_name: e.target.value,
                    })
                  }
                  placeholder="例如：台式机 / 笔记本"
                />
                <label className="flex items-center gap-2 text-sm self-end pb-2 text-ink">
                  <input
                    type="checkbox"
                    checked={draft.nas?.sync_images ?? true}
                    onChange={(e) =>
                      update('nas', {
                        ...(draft.nas ?? { enabled: false, base_url: '', token: '', device_id: '', device_name: '', sync_images: true, sync_interval_seconds: 30 }),
                        sync_images: e.target.checked,
                      })
                    }
                    className="accent-primary"
                  />
                  同步截图原图到 NAS（推送后按需删除本地）
                </label>
              </div>

              <div className="mt-4 flex items-center gap-2 flex-wrap">
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<Plug size={14} />}
                  onClick={() => void onNasTest()}
                  loading={nasTesting}
                >
                  保存并测试连接
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<RefreshCw size={14} />}
                  onClick={() => void onNasSync()}
                  loading={nasSyncing}
                >
                  保存并立即同步
                </Button>
              </div>
            </Card>

            <Card title="同步说明" hoverable={false} bordered={false}>
              <div className="text-sm text-ink3 space-y-2">
                <p>• 同步为<strong>增量推送</strong>：按本地记录 id 游标逐条推送到 NAS，断网后自动补推，重启不丢</p>
                <p>• 首次启用只同步"从现在开始"的新记录，不会一次性上传全部历史</p>
                <p>• NAS 端按 <strong>(设备ID, 记录ID)</strong> 去重，重复推送不会产生重复数据</p>
                <p>• 「分析后保留图片文件」未勾选时：截图先推送到 NAS，随后自动删除本地文件</p>
                <p>• NAS 服务端部署方法见项目 <strong>nas-server/部署说明.md</strong>（支持 Docker 一键部署）</p>
              </div>
            </Card>
          </>
        )}

        {/* Report */}
        {tab === 'report' && (
          <Card
            title="报告偏好"
            description="用于生成的默认值"
            hoverable={false}
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Select
                label="默认模板"
                value={draft.report.default_template}
                onChange={(e) =>
                  update('report', {
                    ...draft.report,
                    default_template: e.target.value,
                  })
                }
              >
                {templates.length === 0 ? (
                  <option value={draft.report.default_template}>
                    {draft.report.default_template || 'standard'}
                  </option>
                ) : (
                  templates.map((t) => (
                    <option key={t.key} value={t.key}>
                      {t.label}（{t.key}）
                    </option>
                  ))
                )}
              </Select>
              <Select
                label="语言"
                value={draft.report.language}
                onChange={(e) =>
                  update('report', {
                    ...draft.report,
                    language: e.target.value,
                  })
                }
              >
                <option value="zh-CN">中文（简体）</option>
                <option value="zh-TW">中文（繁体）</option>
                <option value="en-US">English</option>
                <option value="ja-JP">日本語</option>
              </Select>
              <Input
                label="姓名"
                value={draft.report.user_name}
                onChange={(e) =>
                  update('report', {
                    ...draft.report,
                    user_name: e.target.value,
                  })
                }
              />
              <Input
                label="团队"
                value={draft.report.team}
                onChange={(e) =>
                  update('report', { ...draft.report, team: e.target.value })
                }
              />
            </div>
          </Card>
        )}

        {/* App */}
        {tab === 'app' && (
          <>
            <Card
              title="应用"
              description="开机自启与数据保留策略"
              hoverable={false}
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <label className="flex items-center gap-2 text-sm self-end pb-2 text-ink">
                  <input
                    type="checkbox"
                    checked={draft.app.auto_launch_on_boot}
                    onChange={(e) =>
                      update('app', {
                        ...draft.app,
                        auto_launch_on_boot: e.target.checked,
                      })
                    }
                    className="accent-primary"
                  />
                  开机自启
                </label>
                <label className="flex items-center gap-2 text-sm self-end pb-2 text-ink">
                  <input
                    type="checkbox"
                    checked={draft.app.silent_launch}
                    onChange={(e) =>
                      update('app', {
                        ...draft.app,
                        silent_launch: e.target.checked,
                      })
                    }
                    className="accent-primary"
                  />
                  静默启动（不显示窗口）
                </label>
                <Input
                  label="自动清理（天数，0 关闭）"
                  type="number"
                  min="0"
                  value={draft.app.cleanup_keep_days}
                  onChange={(e) =>
                    update('app', {
                      ...draft.app,
                      cleanup_keep_days: Number(e.target.value),
                    })
                  }
                />
                <Input
                  label="数据库路径"
                  value={draft.db_path}
                  onChange={(e) => update('db_path', e.target.value)}
                  hint="留空使用默认位置"
                />
              </div>
            </Card>
            <Card
              title="Git 提交收集"
              description="定期扫描本地代码仓库，把「我的」提交自动写入时间线（生成日报时的硬证据）"
              hoverable={false}
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <label className="flex items-center gap-2 text-sm self-end pb-2 text-ink">
                  <input
                    type="checkbox"
                    checked={draft.git?.enabled ?? false}
                    onChange={(e) =>
                      update('git', {
                        ...(draft.git ?? { enabled: false, repos: [], author_emails: [], author_names: [], poll_interval_seconds: 600 }),
                        enabled: e.target.checked,
                      })
                    }
                    className="accent-primary"
                  />
                  启用 Git 收集
                </label>
                <Input
                  label="轮询间隔（秒，最小 60）"
                  type="number"
                  min="60"
                  value={draft.git?.poll_interval_seconds ?? 600}
                  onChange={(e) =>
                    update('git', {
                      ...(draft.git ?? { enabled: false, repos: [], author_emails: [], author_names: [], poll_interval_seconds: 600 }),
                      poll_interval_seconds: Number(e.target.value),
                    })
                  }
                />
                <Textarea
                  label="仓库目录（每行一个绝对路径）"
                  rows={3}
                  value={(draft.git?.repos ?? []).join('\n')}
                  onChange={(e) =>
                    update('git', {
                      ...(draft.git ?? { enabled: false, repos: [], author_emails: [], author_names: [], poll_interval_seconds: 600 }),
                      repos: e.target.value.split('\n').map((x) => x.trim()).filter(Boolean),
                    })
                  }
                  placeholder={'D:\\work\\project-a\nD:\\work\\project-b'}
                />
                <Textarea
                  label="我的提交邮箱（每行一个，留空不过滤）"
                  rows={3}
                  value={(draft.git?.author_emails ?? []).join('\n')}
                  onChange={(e) =>
                    update('git', {
                      ...(draft.git ?? { enabled: false, repos: [], author_emails: [], author_names: [], poll_interval_seconds: 600 }),
                      author_emails: e.target.value.split('\n').map((x) => x.trim()).filter(Boolean),
                    })
                  }
                  placeholder={'me@company.com\nme@personal.com'}
                />
                <Textarea
                  label="我的提交姓名（每行一个，与邮箱任一匹配即可）"
                  rows={2}
                  value={(draft.git?.author_names ?? []).join('\n')}
                  onChange={(e) =>
                    update('git', {
                      ...(draft.git ?? { enabled: false, repos: [], author_emails: [], author_names: [], poll_interval_seconds: 600 }),
                      author_names: e.target.value.split('\n').map((x) => x.trim()).filter(Boolean),
                    })
                  }
                  placeholder="张三"
                />
              </div>
            </Card>
            <Card
              title="功能快捷键"
              description="全局热键（主窗口最小化/托盘时同样生效）。留空禁用"
              hoverable={false}
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Input
                  label="唤起待办弹窗"
                  value={draft.todo?.hotkey ?? 'Alt+Space'}
                  onChange={(e) =>
                    update('todo', {
                      ...(draft.todo ?? { hotkey: 'Alt+Space' }),
                      hotkey: e.target.value,
                    })
                  }
                  placeholder="Alt+Space"
                  hint="默认 Alt+Space · 格式如 Alt+Space / CommandOrControl+Shift+T"
                />
                <Input
                  label="切换本地模型分析"
                  value={draft.shortcuts?.local_llm_toggle ?? 'Ctrl+Alt+L'}
                  onChange={(e) =>
                    update('shortcuts', {
                      ...(draft.shortcuts ?? { local_llm_toggle: 'Ctrl+Alt+L' }),
                      local_llm_toggle: e.target.value,
                    })
                  }
                  placeholder="Ctrl+Alt+L"
                  hint="随时把截图分析在 云端/本地 大模型间一键切换"
                />
              </div>
            </Card>
          </>
        )}

        {/* Data */}
        {tab === 'data' && (
          <>
          <Card
            title="数据存储位置"
            description="数据库与截图默认保存在用户目录；可整体迁移到任意位置（如 D 盘或 NAS 挂载盘）"
            hoverable={false}
          >
            <div className="space-y-2 mb-3">
              <div className="flex items-start gap-2 text-sm">
                <span className="text-ink2 w-20 shrink-0">数据库</span>
                <span className="text-ink font-mono text-xs break-all bg-bg/50 rounded-pix px-2 py-1 flex-1">
                  {dStats?.db_path || '—'}
                </span>
              </div>
              <div className="flex items-start gap-2 text-sm">
                <span className="text-ink2 w-20 shrink-0">截图目录</span>
                <span className="text-ink font-mono text-xs break-all bg-bg/50 rounded-pix px-2 py-1 flex-1">
                  {dStats?.screenshot_dir || '—'}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Button
                variant="secondary"
                size="sm"
                icon={<Folder size={13} />}
                onClick={() => {
                  if (dStats?.db_path)
                    void openPath(dStats.db_path).catch((e) => toast.error(`打开失败: ${e}`));
                }}
              >
                打开数据目录
              </Button>
              <Button
                variant="secondary"
                size="sm"
                icon={<Folder size={13} />}
                onClick={() => {
                  if (dStats?.screenshot_dir)
                    void openPath(dStats.screenshot_dir).catch((e) =>
                      toast.error(`打开失败: ${e}`)
                    );
                }}
              >
                打开截图目录
              </Button>
              <Button
                size="sm"
                icon={<FolderOpen size={13} />}
                loading={moving}
                onClick={() => void onMoveData()}
              >
                迁移到新位置…
              </Button>
            </div>
            <p className="text-[11px] text-ink3 mt-2">
              迁移 = 复制数据库 + 全部截图到新目录并切换配置；旧目录文件保留，确认正常后可手动删除
            </p>
          </Card>

          <Card
            title="数据分类管理"
            description="查看各类数据量，按需清理（可同步删除截图文件，或只删记录保留文件）"
            hoverable={false}
          >
            <label className="flex items-center gap-2 text-sm text-ink mb-3">
              <input
                type="checkbox"
                checked={purgeFiles}
                onChange={(e) => setPurgeFiles(e.target.checked)}
                className="accent-primary"
              />
              清理工作记录时同时删除引用的截图文件（关闭则仅删记录、保留文件与路径）
            </label>
            <div className="divide-y divide-border border border-border rounded-md">
              {([
                ['work_logs', '工作记录', dStats?.work_logs],
                ['reports', '报告', dStats?.reports],
                ['todos', '待办', dStats?.todos],
                ['plan_tasks', '规划任务', dStats?.plan_tasks],
                ['assistant_messages', 'AI 对话', dStats?.assistant_messages],
                ['app_usage_sessions', '应用时长会话', dStats?.app_usage_sessions],
              ] as const).map(([cat, label, count]) => (
                <div key={cat} className="flex items-center gap-3 px-3 py-2">
                  <span className="text-sm text-ink flex-1">{label}</span>
                  <span className="text-sm text-ink2 font-mono">{count ?? '—'} 条</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={<Trash2 size={13} />}
                    loading={purgingCat === cat}
                    onClick={() => void onPurgeCategory(cat, label, null)}
                  >
                    清理
                  </Button>
                </div>
              ))}
              <div className="flex items-center gap-3 px-3 py-2">
                <span className="text-sm text-ink flex-1 flex items-center gap-1.5">
                  <Folder size={14} className="text-ink2" />
                  截图文件
                </span>
                <span className="text-sm text-ink2 font-mono">
                  {dStats ? `${dStats.screenshots.file_count} 个 · ${fmtBytes(dStats.screenshots.total_bytes)}` : '—'}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<Trash2 size={13} />}
                  loading={purgingCat === 'screenshots'}
                  onClick={() => void onPurgeCategory('screenshots', '截图文件', null)}
                >
                  清空
                </Button>
              </div>
            </div>
            <div className="mt-3 text-xs text-ink2">
              数据库大小：{dStats ? fmtBytes(dStats.db_bytes) : '—'} · 截图保存目录在「截图」页设置
            </div>
          </Card>

          <Card
            title="加密备份"
            description="导出为密码加密的 .dabak 文件（AES-256-GCM），含全部数据与截图路径；截图图片本体不打包。导入后自动恢复"
            hoverable={false}
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <div className="text-sm font-medium text-ink flex items-center gap-1.5">
                  <Download size={14} /> 导出备份
                </div>
                <Input
                  label="备份密码"
                  type="password"
                  value={expPwd}
                  onChange={(e) => setExpPwd(e.target.value)}
                  placeholder="用于加密，忘记将无法恢复"
                />
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<Download size={13} />}
                  loading={backupBusy === 'export'}
                  disabled={!expPwd}
                  onClick={() => void onExport()}
                >
                  选择位置并导出
                </Button>
              </div>
              <div className="space-y-2">
                <div className="text-sm font-medium text-ink flex items-center gap-1.5">
                  <UploadCloud size={14} /> 导入恢复
                </div>
                <Input
                  label="备份密码"
                  type="password"
                  value={impPwd}
                  onChange={(e) => setImpPwd(e.target.value)}
                  placeholder="该备份文件的密码"
                />
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<UploadCloud size={13} />}
                  loading={backupBusy === 'import'}
                  disabled={!impPwd}
                  onClick={() => void onImport()}
                >
                  选择备份文件并导入
                </Button>
                <p className="text-[11px] text-ink3">导入会覆盖当前数据（账号保留），重启应用后生效</p>
              </div>
            </div>
          </Card>

          <Card
            title="数据管理"
            description="按天数清理工作流水与报告"
            hoverable={false}
            footer={
              <div className="flex items-center gap-2 flex-wrap text-xs text-ink2">
                <AlertTriangle size={12} />
                清理操作不可撤销，请谨慎
              </div>
            }
          >
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
              <Stat
                icon={<ListTree size={18} className="text-primary-700" />}
                label="工作流水"
                value={stats?.work_logs_total ?? '—'}
              />
              <Stat
                icon={<CheckCircle2 size={18} className="text-primary-600" />}
                label="报告数"
                value={stats?.reports_total ?? '—'}
              />
              <Stat
                icon={<Save size={18} className="text-accent-600" />}
                label="时间范围"
                value={
                  stats?.earliest_log
                    ? `${dayjs(stats.earliest_log).format('YY-MM-DD')} ~ ${dayjs(
                        stats.latest_log
                      ).format('YY-MM-DD')}`
                    : '—'
                }
              />
            </div>

            <div className="flex items-end gap-3 flex-wrap">
              <Input
                label="清理多少天之前"
                type="number"
                min="1"
                value={purgeDays}
                onChange={(e) => setPurgeDays(Number(e.target.value))}
                className="w-[200px]"
              />
              <Button
                variant="secondary"
                icon={<Trash2 size={14} />}
                onClick={() => void onPurgeBefore()}
                loading={purging}
              >
                清理早于 {purgeDays} 天的数据
              </Button>
              <Button
                variant="danger"
                icon={<Trash2 size={14} />}
                onClick={() => void onPurgeAll()}
                loading={purging}
              >
                清空全部
              </Button>
            </div>
          </Card>
          </>
        )}

        {tab === 'account' && (
          <>
            <Card
              title="本地账号"
              description={
                acct
                  ? acct.has_account
                    ? `账号：${acct.username ?? '-'} · 登录${acct.enabled ? '已启用（启动应用需输入密码）' : '未启用'}`
                    : '尚未创建账号。创建后可启用启动登录，保护本地数据'
                  : '加载中...'
              }
              hoverable={false}
            >
              {!acct?.has_account ? (
                <div className="space-y-3 max-w-md">
                  <Input label="用户名" value={acctUser} onChange={(e) => setAcctUser(e.target.value)} placeholder="例如：风雅" />
                  <Input label="密码（至少 4 位）" type="password" value={acctNewPwd} onChange={(e) => setAcctNewPwd(e.target.value)} />
                  <Input label="确认密码" type="password" value={acctNewPwd2} onChange={(e) => setAcctNewPwd2(e.target.value)} />
                  <Button
                    size="sm"
                    icon={<Lock size={13} />}
                    loading={acctBusy}
                    disabled={!acctUser || !acctNewPwd || acctNewPwd !== acctNewPwd2}
                    onClick={async () => {
                      setAcctBusy(true);
                      try {
                        await accountSetup(acctUser, acctNewPwd);
                        toast.success('账号已创建，登录已启用（下次启动生效）');
                        setAcct(await accountStatus());
                        setAcctNewPwd('');
                        setAcctNewPwd2('');
                      } catch (e: any) {
                        toast.error(`创建失败: ${e}`);
                      } finally {
                        setAcctBusy(false);
                      }
                    }}
                  >
                    创建账号并启用登录
                  </Button>
                  <p className="text-[11px] text-ink3">
                    账号只保存在本地数据库（密码 PBKDF2 加盐哈希，不存明文、不上传）。忘记密码只能删除数据库文件重置。
                  </p>
                </div>
              ) : (
                <div className="space-y-5 max-w-md">
                  <div className="space-y-2">
                    <div className="text-sm font-medium text-ink">修改密码</div>
                    <Input label="旧密码" type="password" value={acctOldPwd} onChange={(e) => setAcctOldPwd(e.target.value)} />
                    <Input label="新密码（至少 4 位）" type="password" value={acctNewPwd} onChange={(e) => setAcctNewPwd(e.target.value)} />
                    <Input label="确认新密码" type="password" value={acctNewPwd2} onChange={(e) => setAcctNewPwd2(e.target.value)} />
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={acctBusy}
                      disabled={!acctOldPwd || !acctNewPwd || acctNewPwd !== acctNewPwd2}
                      onClick={async () => {
                        setAcctBusy(true);
                        try {
                          await accountChangePassword(acctOldPwd, acctNewPwd);
                          toast.success('密码已修改');
                          setAcctOldPwd('');
                          setAcctNewPwd('');
                          setAcctNewPwd2('');
                        } catch (e: any) {
                          toast.error(`修改失败: ${e}`);
                        } finally {
                          setAcctBusy(false);
                        }
                      }}
                    >
                      修改密码
                    </Button>
                  </div>
                  <div className="space-y-2 pt-3 border-t border-border">
                    <div className="text-sm font-medium text-ink">
                      启动登录：{acct.enabled ? '已启用' : '未启用'}
                    </div>
                    <div className="flex items-center gap-2">
                      <Input
                        label="输入密码以更改开关"
                        type="password"
                        value={acctTogglePwd}
                        onChange={(e) => setAcctTogglePwd(e.target.value)}
                        className="flex-1"
                      />
                      <Button
                        variant={acct.enabled ? 'danger' : 'secondary'}
                        size="sm"
                        loading={acctBusy}
                        disabled={!acctTogglePwd}
                        onClick={async () => {
                          setAcctBusy(true);
                          try {
                            await accountSetEnabled(!acct.enabled, acctTogglePwd);
                            toast.success(acct.enabled ? '已关闭启动登录' : '已启用启动登录');
                            setAcct(await accountStatus());
                            setAcctTogglePwd('');
                          } catch (e: any) {
                            toast.error(`操作失败: ${e}`);
                          } finally {
                            setAcctBusy(false);
                          }
                        }}
                      >
                        {acct.enabled ? '关闭启动登录' : '启用启动登录'}
                      </Button>
                    </div>
                    <p className="text-[11px] text-ink3">
                      测试登录功能：如果开启了「设置 → 应用 → 静默启动」，锁定界面同样会出现。
                    </p>
                  </div>
                </div>
              )}
            </Card>
          </>
        )}

        {tab === 'about' && (
          <>
            <Card title="版本信息" hoverable={false}>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-bg/50 rounded-pix p-3 border border-border">
                  <div className="text-xs text-ink2">版本号</div>
                  <div className="text-lg font-semibold text-ink mt-1">v1.7.2</div>
                </div>
                <div className="bg-bg/50 rounded-pix p-3 border border-border">
                  <div className="text-xs text-ink2">更新日期</div>
                  <div className="text-lg font-semibold text-ink mt-1">2026-09-06</div>
                </div>
                <div className="bg-bg/50 rounded-pix p-3 border border-border">
                  <div className="text-xs text-ink2">框架版本</div>
                  <div className="text-lg font-semibold text-ink mt-1">Tauri v2</div>
                </div>
              </div>
            </Card>

            <Card title="软件介绍" hoverable={false}>
              <div className="space-y-3 text-sm text-ink">
                <p>
                  日报助手是一款基于 AI 的智能工作记录与报告生成工具，帮助您自动记录日常工作内容，轻松生成日报、周报、月报。
                </p>
                <p>
                  通过定时截图、待办管理和手动记录三种方式，全面收集您的工作数据，并利用大语言模型自动分析、分类和扩写，最终生成专业的工作汇报文档。
                </p>
                <div className="flex flex-wrap gap-2 pt-2">
                  <span className="px-2 py-1 text-[11px] bg-primary-50 text-primary-700 rounded-pix border border-primary-200">自动截图</span>
                  <span className="px-2 py-1 text-[11px] bg-primary-50 text-primary-700 rounded-pix border border-primary-200">AI分析</span>
                  <span className="px-2 py-1 text-[11px] bg-primary-50 text-primary-700 rounded-pix border border-primary-200">待办管理</span>
                  <span className="px-2 py-1 text-[11px] bg-primary-50 text-primary-700 rounded-pix border border-primary-200">报告生成</span>
                  <span className="px-2 py-1 text-[11px] bg-primary-50 text-primary-700 rounded-pix border border-primary-200">多格式导出</span>
                </div>
              </div>
            </Card>

            <Card title="软件结构" hoverable={false}>
              <div className="space-y-4">
                <div>
                  <div className="text-xs font-medium text-primary-700 mb-2">前端架构</div>
                  <div className="text-sm text-ink bg-bg/50 rounded-pix p-3 border border-border font-mono text-[11px]">
                    <pre className="whitespace-pre-wrap">src/
├── components/      # UI 组件（TitleBar, Sidebar, Card, Button 等）
├── pages/           # 页面（Home, Todos, Timeline, Reports, Settings）
├── api/             # 后端 API 调用（ipc.ts, types.ts）
├── hooks/           # React Hooks（useConfig, useToast, useWatchStatus）
├── App.tsx          # 应用入口
├── main.tsx         # React 挂载点
└── index.css        # 全局样式</pre>
                  </div>
                </div>
                <div>
                  <div className="text-xs font-medium text-primary-700 mb-2">后端架构</div>
                  <div className="text-sm text-ink bg-bg/50 rounded-pix p-3 border border-border font-mono text-[11px]">
                    <pre className="whitespace-pre-wrap">src-tauri/
├── src/
│   ├── main.rs      # 应用入口
│   ├── commands.rs  # 前端调用的命令
│   ├── state.rs     # 全局状态管理
│   ├── tray.rs      # 系统托盘
│   └── popup.rs     # 待办弹窗
├── crates/
│   ├── core/        # 核心逻辑（截图、存储、LLM调用、报告生成）
│   └── cli/         # 命令行工具
└── tauri.conf.json  # Tauri 配置</pre>
                  </div>
                </div>
              </div>
            </Card>

            <Card title="软件逻辑" hoverable={false}>
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <div className="text-xs font-medium text-primary-700 mb-2">数据收集流程</div>
                    <ul className="text-sm text-ink space-y-1 list-disc list-inside">
                      <li>定时截图 → 视觉模型分析 → 生成工作记录</li>
                      <li>待办完成 → 自动写入时间线</li>
                      <li>手动输入 → 文本模型扩写 → 自动分类</li>
                    </ul>
                  </div>
                  <div>
                    <div className="text-xs font-medium text-primary-700 mb-2">报告生成流程</div>
                    <ul className="text-sm text-ink space-y-1 list-disc list-inside">
                      <li>按日期范围筛选工作记录</li>
                      <li>调用文本模型汇总分析</li>
                      <li>生成 Markdown 格式报告</li>
                      <li>支持导出为 MD/HTML/Word/TXT</li>
                    </ul>
                  </div>
                </div>
                <div className="mt-4">
                  <div className="text-xs font-medium text-primary-700 mb-2">核心数据流向</div>
                  <div className="text-sm text-ink bg-bg/50 rounded-pix p-4 border border-border">
                    <div className="flex flex-wrap items-center justify-center gap-3">
                      <div className="px-3 py-2 bg-primary-100 text-primary-800 rounded-pix text-xs font-medium">待办输入</div>
                      <span className="text-primary-400">→</span>
                      <div className="px-3 py-2 bg-primary-100 text-primary-800 rounded-pix text-xs font-medium">截图监听</div>
                      <span className="text-primary-400">→</span>
                      <div className="px-3 py-2 bg-primary-100 text-primary-800 rounded-pix text-xs font-medium">手动记录</div>
                      <span className="text-primary-400">→</span>
                      <div className="px-3 py-2 bg-accent-100 text-accent-800 rounded-pix text-xs font-medium">LLM 分析扩写</div>
                      <span className="text-primary-400">→</span>
                      <div className="px-3 py-2 bg-accent-100 text-accent-800 rounded-pix text-xs font-medium">工作流水 (WorkLog)</div>
                      <span className="text-primary-400">→</span>
                      <div className="px-3 py-2 bg-green-100 text-green-800 rounded-pix text-xs font-medium">日报/周报/月报</div>
                    </div>
                  </div>
                </div>
              </div>
            </Card>

            <Card title="技术栈" hoverable={false}>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="bg-bg/50 rounded-pix p-3 border border-border text-center">
                  <div className="text-sm font-medium text-ink">前端</div>
                  <div className="text-xs text-ink2 mt-1">React 18 + TypeScript</div>
                </div>
                <div className="bg-bg/50 rounded-pix p-3 border border-border text-center">
                  <div className="text-sm font-medium text-ink">框架</div>
                  <div className="text-xs text-ink2 mt-1">Tauri v2</div>
                </div>
                <div className="bg-bg/50 rounded-pix p-3 border border-border text-center">
                  <div className="text-sm font-medium text-ink">样式</div>
                  <div className="text-xs text-ink2 mt-1">Tailwind CSS 3</div>
                </div>
                <div className="bg-bg/50 rounded-pix p-3 border border-border text-center">
                  <div className="text-sm font-medium text-ink">后端</div>
                  <div className="text-xs text-ink2 mt-1">Rust</div>
                </div>
              </div>
            </Card>
          </>
        )}

        {/* 我的资料弹窗 */}
        {showProfileModal && profileDraft && (
          <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div className="absolute inset-0 bg-black/40" onClick={() => setShowProfileModal(false)} />
            <div className="relative bg-card rounded-lg shadow-xl w-full max-w-2xl max-h-[88vh] overflow-auto">
              <div className="flex items-center justify-between px-5 py-3 border-b border-border">
                <div>
                  <h2 className="text-base font-semibold text-ink">我的资料</h2>
                  <p className="text-xs text-ink2 mt-0.5">
                    这些资料只由你主动维护，用于帮助 AI 理解你的人名、组织、项目和长期工作背景。
                  </p>
                </div>
                <button onClick={() => setShowProfileModal(false)} className="p-1 rounded-pix text-ink2 hover:text-ink hover:bg-bg">
                  <X size={16} />
                </button>
              </div>
              <div className="p-5 space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <Input
                    label="希望如何称呼你 *"
                    value={profileDraft.display_name}
                    onChange={(e) => setProfileDraft({ ...profileDraft, display_name: e.target.value })}
                    placeholder="怎么称呼你"
                  />
                  <Input
                    label="其他称呼"
                    value={profileDraft.aliases}
                    onChange={(e) => setProfileDraft({ ...profileDraft, aliases: e.target.value })}
                    placeholder="例如：小黑、Leo 哥"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="label">角色与自我定位</label>
                  <textarea
                    className="input min-h-[56px] resize-none"
                    placeholder="例如：AI 应用层创业者、产品负责人"
                    value={profileDraft.role}
                    onChange={(e) => setProfileDraft({ ...profileDraft, role: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="label">公司、组织与岗位</label>
                  <textarea
                    className="input min-h-[56px] resize-none"
                    placeholder="填写你所在或经营的公司、组织，以及对应岗位"
                    value={profileDraft.org}
                    onChange={(e) => setProfileDraft({ ...profileDraft, org: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="label">当前项目、产品与业务背景</label>
                  <textarea
                    className="input min-h-[56px] resize-none"
                    placeholder="填写当前长期推进的项目、产品、客户或业务方向"
                    value={profileDraft.projects}
                    onChange={(e) => setProfileDraft({ ...profileDraft, projects: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="label">核心职责与常见工作</label>
                  <textarea
                    className="input min-h-[56px] resize-none"
                    placeholder="填写你通常负责的事项和日常工作范围"
                    value={profileDraft.responsibilities}
                    onChange={(e) => setProfileDraft({ ...profileDraft, responsibilities: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="label">团队成员与常见协作者</label>
                  <textarea
                    className="input min-h-[56px] resize-none"
                    placeholder="填写常见协作者及其角色，避免 AI 混淆人物关系"
                    value={profileDraft.collaborators}
                    onChange={(e) => setProfileDraft({ ...profileDraft, collaborators: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="label">其他长期信息</label>
                  <textarea
                    className="input min-h-[56px] resize-none"
                    placeholder="补充其他希望 AI 长期了解、且相对稳定的信息"
                    value={profileDraft.extra}
                    onChange={(e) => setProfileDraft({ ...profileDraft, extra: e.target.value })}
                  />
                </div>
              </div>
              <div className="flex items-center justify-between px-5 py-3 border-t border-border">
                <span className="text-xs text-ink2">
                  资料保存在本地，只会在相关 AI 功能中按需使用 ·{' '}
                  {Object.values(profileDraft).join('').length}/12000
                </span>
                <div className="flex items-center gap-2">
                  <Button variant="secondary" size="sm" onClick={() => setShowProfileModal(false)}>
                    取消
                  </Button>
                  <Button
                    size="sm"
                    disabled={!profileDraft.display_name.trim()}
                    onClick={() => {
                      const next = { ...draft, profile: profileDraft };
                      void save(next).then(() => {
                        setDraft(next);
                        setShowProfileModal(false);
                        toast.success('我的资料已保存');
                      });
                    }}
                  >
                    保存修改
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 自定义指令弹窗 */}
        {showCustomModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div className="absolute inset-0 bg-black/40" onClick={() => setShowCustomModal(false)} />
            <div className="relative bg-card rounded-lg shadow-xl w-full max-w-xl">
              <div className="flex items-center justify-between px-5 py-3 border-b border-border">
                <div>
                  <h2 className="text-base font-semibold text-ink">自定义指令</h2>
                  <p className="text-xs text-ink2 mt-0.5">
                    会在生成日报或报告时交给模型遵循；不填则由 AI 根据模板和工作记录自动组织内容。
                  </p>
                </div>
                <button onClick={() => setShowCustomModal(false)} className="p-1 rounded-pix text-ink2 hover:text-ink hover:bg-bg">
                  <X size={16} />
                </button>
              </div>
              <div className="p-5">
                <textarea
                  className="input min-h-[180px] resize-y"
                  placeholder="这里可以写任何希望 AI 在生成日报/报告时遵循的要求，例如：按 Markdown 输出；重点突出项目成果和风险；弱化或删除游戏、微信闲聊等无关记录；不要编造未出现的事项；语气简洁、适合发给领导。"
                  value={customDraft}
                  onChange={(e) => setCustomDraft(e.target.value)}
                />
                <p className="text-xs text-ink2 mt-2">{customDraft.length} 字 · 保存后立即对日报/周报/月报生效</p>
              </div>
              <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border">
                <Button variant="secondary" size="sm" onClick={() => setShowCustomModal(false)}>
                  取消
                </Button>
                <Button
                  size="sm"
                  onClick={() => {
                    const next = {
                      ...draft,
                      report: { ...draft.report, custom_instructions: customDraft },
                    };
                    void save(next).then(() => {
                      setDraft(next);
                      setShowCustomModal(false);
                      toast.success('自定义指令已保存');
                    });
                  }}
                >
                  保存
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="rounded-pix border border-border p-3 flex items-center gap-3 bg-bg/40 hover:bg-primary-50/50 transition-colors">
      <span className="w-8 h-8 rounded-pix bg-white flex items-center justify-center border border-border">
        {icon}
      </span>
      <div className="min-w-0">
        <div className="text-xs text-ink2">{label}</div>
        <div className="text-sm font-semibold mt-0.5 truncate text-ink">{value}</div>
      </div>
    </div>
  );
}

// 常见 provider 标识；不在列表的会作为额外选项保留，避免老配置丢值。
const PROVIDER_OPTIONS = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'anthropic', label: 'Anthropic (Claude)' },
  { value: 'azure', label: 'Azure OpenAI' },
  { value: 'ollama', label: 'Ollama' },
  { value: 'gemini', label: 'Google Gemini' },
  { value: 'deepseek', label: 'DeepSeek' },
  { value: 'moonshot', label: 'Moonshot (Kimi)' },
  { value: 'qwen', label: 'Qwen (DashScope)' },
  { value: 'zhipu', label: 'Zhipu (智谱)' },
  { value: 'mistral', label: 'Mistral' },
  { value: 'groq', label: 'Groq' },
  { value: 'openrouter', label: 'OpenRouter' },
  { value: 'custom', label: '自定义' },
] as const;

function ProviderSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const known = PROVIDER_OPTIONS.some((o) => o.value === value);
  return (
    <Select
      label="Provider"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {!known && value ? (
        <option value={value}>{value}（自定义）</option>
      ) : null}
      {PROVIDER_OPTIONS.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </Select>
  );
}
