import type { Dispatch, SetStateAction, ReactNode } from 'react';
import type { useNavigate } from 'react-router-dom';
import type {
  AccountStatus,
  Config,
  DataStats,
  LlmProvider,
  ReportTemplate,
  StorageStats,
} from '../../api/types';
import type { useToast } from '../../hooks/useToast';

type D<T> = Dispatch<SetStateAction<T>>;

/** Settings 各 Tab 共享的上下文：状态与处理器都留在 index.tsx，Tab 只消费 */
export interface SettingsCtx {
  draft: Config;
  setDraft: D<Config | null>;
  update: <K extends keyof Config>(key: K, value: Config[K]) => void;
  onSave: () => Promise<void>;
  saving: boolean;
  toast: ReturnType<typeof useToast>;
  navigate: ReturnType<typeof useNavigate>;
  config: Config | null;
  save: (cfg: Config) => Promise<void>;
  stats: StorageStats | null;
  setStats: D<StorageStats | null>;
  refreshStats: () => Promise<void>;
  fmtBytes: (n: number) => string;
  purgeDays: number;
  setPurgeDays: D<number>;
  purging: boolean;
  setPurging: D<boolean>;
  purgeFiles: boolean;
  setPurgeFiles: D<boolean>;
  purgingCat: string | null;
  setPurgingCat: D<string | null>;
  onPurgeCategory: (category: string, label: string, keepDays: number | null) => Promise<void>;
  onPurgeBefore: () => Promise<void>;
  onPurgeAll: () => Promise<void>;
  dStats: DataStats | null;
  refreshDataStats: () => Promise<void>;
  moving: boolean;
  setMoving: D<boolean>;
  onMoveData: () => Promise<void>;
  nasTesting: boolean;
  setNasTesting: D<boolean>;
  onNasTest: () => Promise<void>;
  nasSyncing: boolean;
  setNasSyncing: D<boolean>;
  onNasSync: () => Promise<void>;
  expPwd: string;
  setExpPwd: D<string>;
  impPwd: string;
  setImpPwd: D<string>;
  backupBusy: 'export' | 'import' | null;
  setBackupBusy: D<'export' | 'import' | null>;
  onExport: () => Promise<void>;
  onImport: () => Promise<void>;
  acct: AccountStatus;
  setAcct: D<AccountStatus | null>;
  acctUser: string;
  setAcctUser: D<string>;
  acctNewPwd: string;
  setAcctNewPwd: D<string>;
  acctNewPwd2: string;
  setAcctNewPwd2: D<string>;
  acctOldPwd: string;
  setAcctOldPwd: D<string>;
  acctTogglePwd: string;
  setAcctTogglePwd: D<string>;
  acctBusy: boolean;
  setAcctBusy: D<boolean>;
  showProfileModal: boolean;
  setShowProfileModal: D<boolean>;
  profileDraft: Config['profile'] | null;
  setProfileDraft: D<Config['profile'] | null>;
  showCustomModal: boolean;
  setShowCustomModal: D<boolean>;
  customDraft: string;
  setCustomDraft: D<string>;
  selectedProviderId: string;
  setSelectedProviderId: D<string>;
  selectedProvider: LlmProvider;
  testing: boolean;
  setTesting: D<boolean>;
  onTest: () => Promise<void>;
  addProvider: (
    template: 'openai' | 'openai-vision' | 'claude' | 'deepseek' | 'qwencloud' | 'local-ollama' | 'custom'
  ) => void;
  updateProvider: (id: string, patch: Partial<LlmProvider>) => void;
  removeProvider: (id: string) => void;
  templates: ReportTemplate[];
  setTemplates: D<ReportTemplate[]>;
  pushTesting: boolean;
  setPushTesting: D<boolean>;
}

export type SettingsCtxProps = { ctx: SettingsCtx };
export type ReactNodeLike = ReactNode;
