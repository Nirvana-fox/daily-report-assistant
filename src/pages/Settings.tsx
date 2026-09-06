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
} from 'lucide-react';

import Card from '../components/Card';
import Button from '../components/Button';
import Tabs from '../components/Tabs';
import Spinner from '../components/Spinner';
import { Input, Select, Textarea } from '../components/Input';
import {
  listTemplates,
  nasSyncNow,
  nasTestConnection,
  openLogDir,
  purgeAll,
  purgeBefore,
  storageStats,
  testLlmConnection,
} from '../api/ipc';
import { useConfig } from '../hooks/useConfig';
import type {
  Config,
  LlmProvider,
  ReportTemplate,
  StorageStats,
} from '../api/types';
import { useToast } from '../hooks/useToast';
import dayjs from 'dayjs';

type TabKey = 'llm' | 'screenshot' | 'nas' | 'report' | 'app' | 'data' | 'about';

const SETTING_TABS = [
  { key: 'llm' as const, label: 'LLM', icon: <Cpu size={14} /> },
  { key: 'screenshot' as const, label: '截图', icon: <Camera size={14} /> },
  { key: 'nas' as const, label: 'NAS 同步', icon: <HardDrive size={14} /> },
  { key: 'report' as const, label: '报告', icon: <FileText size={14} /> },
  { key: 'app' as const, label: '应用', icon: <SettingsIcon size={14} /> },
  { key: 'data' as const, label: '数据', icon: <Database size={14} /> },
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
          <Card
            title="数据管理"
            description="存储统计与清理"
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
        )}

        {tab === 'about' && (
          <>
            <Card title="版本信息" hoverable={false}>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-bg/50 rounded-pix p-3 border border-border">
                  <div className="text-xs text-ink2">版本号</div>
                  <div className="text-lg font-semibold text-ink mt-1">v1.5.0</div>
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
