import { useEffect, useState, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
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
  Palette,
  ClipboardList,
  X,
  Bell,
  Send,
  Lock,
  Download,
  UploadCloud,
  Folder,
} from 'lucide-react';

import Card from '../../components/Card';
import Button from '../../components/Button';
import Tabs from '../../components/Tabs';
import Spinner from '../../components/Spinner';
import { Input, Select, Textarea } from '../../components/Input';
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
} from '../../api/ipc';
import { useConfig } from '../../hooks/useConfig';
import type {
  AccountStatus,
  Config,
  DataStats,
  LlmProvider,
  ReportTemplate,
  StorageStats,
} from '../../api/types';
import { useToast } from '../../hooks/useToast';
import AppearanceTab from './AppearanceTab';
import dayjs from 'dayjs';
import type { SettingsCtx } from './ctx';
import ModelTab from './tabs/ModelTab';
import PersonalTab from './tabs/PersonalTab';
import CaptureTab from './tabs/CaptureTab';
import ReportTab from './tabs/ReportTab';
import DataTab from './tabs/DataTab';
import GeneralTab from './tabs/GeneralTab';


type TabKey =
  | 'model'
  | 'capture'
  | 'appearance'
  | 'personal'
  | 'report'
  | 'data'
  | 'general';

const SETTING_TABS = [
  { key: 'model' as const, label: '模型', icon: <Cpu size={14} /> },
  { key: 'appearance' as const, label: '外观', icon: <Palette size={14} /> },
  { key: 'capture' as const, label: '采集与隐私', icon: <Camera size={14} /> },
  { key: 'personal' as const, label: '个性化', icon: <UserCog size={14} /> },
  { key: 'report' as const, label: '报告与推送', icon: <FileText size={14} /> },
  { key: 'data' as const, label: '数据与同步', icon: <Database size={14} /> },
  { key: 'general' as const, label: '通用', icon: <SettingsIcon size={14} /> },
];

export default function Settings() {
  const toast = useToast();
  const navigate = useNavigate();
  const { config, save, saving, loading } = useConfig();
  const [tab, setTab] = useState<TabKey>('model');
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

  const ctx: SettingsCtx = {
    draft, setDraft, update, onSave, saving,
    toast, navigate, config, save,
    stats, setStats, refreshStats, fmtBytes,
    purgeDays, setPurgeDays, purging, setPurging, purgeFiles, setPurgeFiles,
    purgingCat, setPurgingCat, onPurgeCategory, onPurgeBefore, onPurgeAll,
    dStats, refreshDataStats, moving, setMoving, onMoveData,
    nasTesting, setNasTesting, onNasTest, nasSyncing, setNasSyncing, onNasSync,
    expPwd, setExpPwd, impPwd, setImpPwd, backupBusy, setBackupBusy,
    onExport, onImport,
    acct: acct!, setAcct, acctUser, setAcctUser, acctNewPwd, setAcctNewPwd,
    acctNewPwd2, setAcctNewPwd2, acctOldPwd, setAcctOldPwd,
    acctTogglePwd, setAcctTogglePwd, acctBusy, setAcctBusy,
    showProfileModal, setShowProfileModal, profileDraft, setProfileDraft,
    showCustomModal, setShowCustomModal, customDraft, setCustomDraft,
    selectedProviderId, setSelectedProviderId, selectedProvider: selectedProvider!,
    testing, setTesting, onTest, addProvider, updateProvider, removeProvider,
    templates, setTemplates, pushTesting, setPushTesting,
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
        {tab === 'appearance' && <AppearanceTab />}
        {tab === 'model' && <ModelTab ctx={ctx} />}
        {tab === 'personal' && <PersonalTab ctx={ctx} />}
        {tab === 'capture' && <CaptureTab ctx={ctx} />}
        {tab === 'report' && <ReportTab ctx={ctx} />}
        {tab === 'data' && <DataTab ctx={ctx} />}
        {tab === 'general' && <GeneralTab ctx={ctx} />}
      </div>

      {/* 页面级弹窗（原样保留，非 tab 内容） */}
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
  );
}
