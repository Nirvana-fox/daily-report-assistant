//! 设置页 · ModelTab（JSX 原样搬移自原 Settings.tsx，共享状态经 ctx 注入）
import { Plug, Trash2, Cpu, Plus } from 'lucide-react';
import { Input, Select } from '../../../components/Input';
import Card from '../../../components/Card';
import Button from '../../../components/Button';
import { ProviderSelect } from '../components';
import type { SettingsCtx, SettingsCtxProps } from '../ctx';

export default function ModelTab({ ctx }: SettingsCtxProps) {
  return (
    <>
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
                  onClick={() => ctx.addProvider('openai')}
                >
                  添加 OpenAI
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<Plus size={14} />}
                  onClick={() => ctx.addProvider('openai-vision')}
                >
                  OpenAI (视觉)
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<Plus size={14} />}
                  onClick={() => ctx.addProvider('claude')}
                >
                  添加 Claude
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<Plus size={14} />}
                  onClick={() => ctx.addProvider('deepseek')}
                >
                  DeepSeek (文本)
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<Plus size={14} />}
                  onClick={() => ctx.addProvider('qwencloud')}
                >
                  QwenCloud (视觉)
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<Plus size={14} />}
                  onClick={() => ctx.addProvider('custom')}
                >
                  自定义
                </Button>
              </div>
            </div>

            {/* providers 列表 */}
            <div className="border border-border rounded-md divide-y divide-border bg-card mb-4">
              {ctx.draft.llm.providers.length === 0 ? (
                <div className="px-3 py-6 text-sm text-ink2 text-center">
                  尚未添加任何 provider。点击右上方按钮选择模板新建一个。
                </div>
              ) : (
                ctx.draft.llm.providers.map((p) => {
                  const isSelected = p.id === ctx.selectedProviderId;
                  const isText = p.id === ctx.draft.llm.default_text_id;
                  const isVision = p.id === ctx.draft.llm.default_vision_id;
                  return (
                    <div
                      key={p.id}
                      onClick={() => ctx.setSelectedProviderId(p.id)}
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
                          ctx.removeProvider(p.id);
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
            {ctx.selectedProvider ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Input
                  label="显示名称"
                  value={ctx.selectedProvider.name}
                  onChange={(e) =>
                    ctx.updateProvider(ctx.selectedProvider.id, { name: e.target.value })
                  }
                  placeholder="用于在列表中识别这条 provider"
                />
                <ProviderSelect
                  value={ctx.selectedProvider.provider}
                  onChange={(v) =>
                    ctx.updateProvider(ctx.selectedProvider.id, { provider: v })
                  }
                />
                <Input
                  label="Base URL"
                  value={ctx.selectedProvider.base_url}
                  onChange={(e) =>
                    ctx.updateProvider(ctx.selectedProvider.id, {
                      base_url: e.target.value.trim().replace(".com.com", ".com").replace(".ai.ai", ".ai").replace(".net.net", ".net").trimEnd(),
                    })
                  }
                  placeholder="https://api.openai.com/v1"
                  hint="注意：不要输入重复的域名后缀（如 .com.com）"
                />
                <Input
                  label="API Key"
                  type="password"
                  value={ctx.selectedProvider.api_key}
                  onChange={(e) =>
                    ctx.updateProvider(ctx.selectedProvider.id, {
                      api_key: e.target.value,
                    })
                  }
                  placeholder="sk-..."
                />
                <Input
                  label="模型"
                  value={ctx.selectedProvider.model}
                  onChange={(e) =>
                    ctx.updateProvider(ctx.selectedProvider.id, {
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
                  value={ctx.selectedProvider.temperature}
                  onChange={(e) =>
                    ctx.updateProvider(ctx.selectedProvider.id, {
                      temperature: Number(e.target.value),
                    })
                  }
                />
                <Input
                  label="超时（秒）"
                  type="number"
                  min="1"
                  value={ctx.selectedProvider.timeout}
                  onChange={(e) =>
                    ctx.updateProvider(ctx.selectedProvider.id, {
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
                value={ctx.draft.llm.default_text_id}
                onChange={(e) =>
                  ctx.update('llm', { ...ctx.draft.llm, default_text_id: e.target.value })
                }
              >
                <option value="">— 未指定 —</option>
                {ctx.draft.llm.providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name?.trim() ? p.name : `${p.provider} · ${p.model}`}
                  </option>
                ))}
              </Select>
              <Select
                label="默认视觉模型"
                value={ctx.draft.llm.default_vision_id}
                onChange={(e) =>
                  ctx.update('llm', {
                    ...ctx.draft.llm,
                    default_vision_id: e.target.value,
                  })
                }
              >
                <option value="">— 未指定 —</option>
                {ctx.draft.llm.providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name?.trim() ? p.name : `${p.provider} · ${p.model}`}
                  </option>
                ))}
              </Select>
              <Select
                label="本地视觉模型（功能热键切换用）"
                value={ctx.draft.llm.default_local_vision_id ?? ''}
                onChange={(e) =>
                  ctx.update('llm', {
                    ...ctx.draft.llm,
                    default_local_vision_id: e.target.value,
                  })
                }
                hint="添加一条 Ollama / LM Studio 等 provider 并在此指定，用 Ctrl+Alt+L 一键切换到本地分析"
              >
                <option value="">— 未指定 —</option>
                {ctx.draft.llm.providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name?.trim() ? p.name : `${p.provider} · ${p.model}`}
                  </option>
                ))}
              </Select>
              <Select
                label="OCR 识别模型（可选）"
                value={ctx.draft.llm.ocr_provider_id ?? ''}
                onChange={(e) =>
                  ctx.update('llm', {
                    ...ctx.draft.llm,
                    ocr_provider_id: e.target.value,
                  })
                }
                hint="两段式分析：截图先经 OCR 提取全部文字，再交给默认文本模型归纳。识别更精确但截图原图会上传到该服务商（如智谱 glm-ocr）；失败自动回退默认视觉模型"
              >
                <option value="">— 不启用 —</option>
                {ctx.draft.llm.providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name?.trim() ? p.name : `${p.provider} · ${p.model}`}
                  </option>
                ))}
              </Select>
              <label className="flex items-center gap-2 text-sm self-end pb-2 text-ink">
                <input
                  type="checkbox"
                  checked={ctx.draft.llm.use_local_vision ?? false}
                  onChange={(e) =>
                    ctx.update('llm', {
                      ...ctx.draft.llm,
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
                onClick={() => ctx.addProvider('local-ollama')}
              >
                添加 Ollama 本地模型
              </Button>
            </div>

            <div className="mt-3">
              <Button
                variant="secondary"
                size="sm"
                icon={<Plug size={14} />}
                onClick={() => void ctx.onTest()}
                loading={ctx.testing}
                disabled={!ctx.selectedProvider}
              >
                测试当前 provider
              </Button>
            </div>
          </Card>
    </>
  );
}
