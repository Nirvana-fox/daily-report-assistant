import type { ReactNode } from 'react';
import { Select } from '../../components/Input';

export function Stat({
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
      <span className="w-8 h-8 rounded-pix bg-card flex items-center justify-center border border-border">
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

export function ProviderSelect({
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
