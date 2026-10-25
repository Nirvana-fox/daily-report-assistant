//! 设置页 · CaptureTab（JSX 原样搬移自原 Settings.tsx，共享状态经 ctx 注入）
import { Plus } from 'lucide-react';
import { Input } from '../../../components/Input';
import Card from '../../../components/Card';
import Button from '../../../components/Button';
import type { SettingsCtx, SettingsCtxProps } from '../ctx';

export default function CaptureTab({ ctx }: SettingsCtxProps) {
  return (
    <>
          <Card title="截图" description="周期截图与视觉理解" hoverable={false}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Input
                label="间隔（秒）"
                type="number"
                min="10"
                value={ctx.draft.screenshot.interval_seconds}
                onChange={(e) =>
                  ctx.update('screenshot', {
                    ...ctx.draft.screenshot,
                    interval_seconds: Number(e.target.value),
                  })
                }
              />
              <Input
                label="空闲跳过（秒，0 关闭）"
                type="number"
                min="0"
                value={ctx.draft.screenshot.idle_skip_seconds}
                onChange={(e) =>
                  ctx.update('screenshot', {
                    ...ctx.draft.screenshot,
                    idle_skip_seconds: Number(e.target.value),
                  })
                }
              />
              <Input
                label="显示器索引"
                type="number"
                min="0"
                value={ctx.draft.screenshot.monitor_index}
                onChange={(e) =>
                  ctx.update('screenshot', {
                    ...ctx.draft.screenshot,
                    monitor_index: Number(e.target.value),
                  })
                }
                hint="0 表示主显示器"
              />
              <Input
                label="输出目录"
                value={ctx.draft.screenshot.output_dir}
                onChange={(e) =>
                  ctx.update('screenshot', {
                    ...ctx.draft.screenshot,
                    output_dir: e.target.value,
                  })
                }
                placeholder="留空使用默认"
              />
              <label className="flex items-center gap-2 text-sm self-end pb-2 text-ink">
                <input
                  type="checkbox"
                  checked={ctx.draft.screenshot.enabled}
                  onChange={(e) =>
                    ctx.update('screenshot', {
                      ...ctx.draft.screenshot,
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
                  checked={ctx.draft.screenshot.auto_start}
                  onChange={(e) =>
                    ctx.update('screenshot', {
                      ...ctx.draft.screenshot,
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
                  checked={ctx.draft.screenshot.keep_after_analysis}
                  onChange={(e) =>
                    ctx.update('screenshot', {
                      ...ctx.draft.screenshot,
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
                  checked={ctx.draft.screenshot.dedup_screenshots ?? true}
                  onChange={(e) =>
                    ctx.update('screenshot', {
                      ...ctx.draft.screenshot,
                      dedup_screenshots: e.target.checked,
                    })
                  }
                  className="accent-primary"
                />
                画面未变化时跳过分析（内容去重，显著节省 token）
              </label>
            </div>

            <div className="mt-5 pt-4 border-t border-border">
              <label className="block text-sm font-medium text-ink mb-1">排除清单</label>
              <p className="text-[11px] text-ink2 mb-2">
                命中这些关键词的应用不截图、不记录、不计入应用时长（匹配应用名或窗口标题的子串，大小写不敏感）。例如：微信、游戏、steam
              </p>
              <input
                type="text"
                className="w-full text-sm rounded-pix border border-border bg-bg px-3 py-2 text-ink placeholder:text-ink2/60 focus:outline-none focus:ring-1 focus:ring-primary"
                placeholder="多个关键词用顿号或逗号分隔"
                value={(ctx.draft.screenshot.exclude_apps ?? []).join('、')}
                onChange={(e) =>
                  ctx.update('screenshot', {
                    ...ctx.draft.screenshot,
                    exclude_apps: e.target.value
                      .split(/[、,，;；\n]/)
                      .map((s) => s.trim())
                      .filter(Boolean),
                  })
                }
              />
            </div>

            <div className="mt-5 pt-4 border-t border-border">
              <div className="flex items-center justify-between mb-1">
                <label className="block text-sm font-medium text-ink">不记录时段</label>
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<Plus size={14} />}
                  onClick={() =>
                    ctx.update('screenshot', {
                      ...ctx.draft.screenshot,
                      quiet_periods: [
                        ...(ctx.draft.screenshot.quiet_periods ?? []),
                        { start: '22:00', end: '08:00' },
                      ],
                    })
                  }
                >
                  添加时段
                </Button>
              </div>
              <p className="text-[11px] text-ink2 mb-2">
                这些时段内自动暂停采集（支持跨天，如 22:00-08:00）；手动「立即截图」不受时段限制。
              </p>
              {(ctx.draft.screenshot.quiet_periods ?? []).length === 0 ? (
                <div className="text-sm text-ink2 py-1">未设置，全天记录。</div>
              ) : (
                <div className="space-y-2">
                  {(ctx.draft.screenshot.quiet_periods ?? []).map((p, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <input
                        type="time"
                        className="text-sm rounded-pix border border-border bg-bg px-2 py-1.5 text-ink focus:outline-none focus:ring-1 focus:ring-primary"
                        value={p.start}
                        onChange={(e) => {
                          const next = [...(ctx.draft.screenshot.quiet_periods ?? [])];
                          next[i] = { ...next[i], start: e.target.value };
                          ctx.update('screenshot', { ...ctx.draft.screenshot, quiet_periods: next });
                        }}
                      />
                      <span className="text-ink2 text-sm">至</span>
                      <input
                        type="time"
                        className="text-sm rounded-pix border border-border bg-bg px-2 py-1.5 text-ink focus:outline-none focus:ring-1 focus:ring-primary"
                        value={p.end}
                        onChange={(e) => {
                          const next = [...(ctx.draft.screenshot.quiet_periods ?? [])];
                          next[i] = { ...next[i], end: e.target.value };
                          ctx.update('screenshot', { ...ctx.draft.screenshot, quiet_periods: next });
                        }}
                      />
                      <button
                        className="text-[12px] text-ink2 hover:text-red-600"
                        onClick={() =>
                          ctx.update('screenshot', {
                            ...ctx.draft.screenshot,
                            quiet_periods: (ctx.draft.screenshot.quiet_periods ?? []).filter(
                              (_, j) => j !== i
                            ),
                          })
                        }
                      >
                        删除
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Card>

          <>
            <Card
              title="隐私脱敏"
              description="截图与工作记录的隐私保护：规则同时注入 AI 提示词（软约束）与本地入库前替换（硬约束），规则完全保存在本地"
              hoverable={false}
            >
              <label className="flex items-center gap-2 text-sm text-ink mb-3">
                <input
                  type="checkbox"
                  checked={ctx.draft.privacy?.enabled ?? true}
                  onChange={(e) =>
                    ctx.update('privacy', {
                      ...(ctx.draft.privacy ?? { enabled: true, extra_prompt_rules: '', mask_words: [] }),
                      enabled: e.target.checked,
                    })
                  }
                  className="accent-primary"
                />
                启用本地二次脱敏（手机号/邮箱/密钥等正则 + 词表，入库前确定性执行）
              </label>
              <div className="mb-3">
                <label className="block text-sm text-ink2 mb-1">自定义脱敏规则（注入 AI 提示词，最高优先级）</label>
                <textarea
                  className="w-full min-h-[80px] text-sm rounded-pix border border-border bg-bg px-3 py-2 text-ink placeholder:text-ink2/60 focus:outline-none focus:ring-1 focus:ring-primary"
                  placeholder={'每行一条，例如：\n不要记录与客户「某某公司」相关的沟通细节\n涉及薪酬、绩效的数字一律脱敏'}
                  value={ctx.draft.privacy?.extra_prompt_rules ?? ''}
                  onChange={(e) =>
                    ctx.update('privacy', {
                      ...(ctx.draft.privacy ?? { enabled: true, extra_prompt_rules: '', mask_words: [] }),
                      extra_prompt_rules: e.target.value,
                    })
                  }
                />
              </div>
              <div>
                <label className="block text-sm text-ink2 mb-1">硬脱敏词表（顿号/逗号分隔，入库前替换为＊＊）</label>
                <input
                  type="text"
                  className="w-full text-sm rounded-pix border border-border bg-bg px-3 py-2 text-ink placeholder:text-ink2/60 focus:outline-none focus:ring-1 focus:ring-primary"
                  placeholder="例如：张三、某某公司、内部代号"
                  value={(ctx.draft.privacy?.mask_words ?? []).join('、')}
                  onChange={(e) =>
                    ctx.update('privacy', {
                      ...(ctx.draft.privacy ?? { enabled: true, extra_prompt_rules: '', mask_words: [] }),
                      mask_words: e.target.value
                        .split(/[、,，;；\n]/)
                        .map((s) => s.trim())
                        .filter(Boolean),
                    })
                  }
                />
                <p className="text-[11px] text-ink2 mt-1">
                  词表匹配大小写不敏感；无论 AI 输出什么，这些词都不会出现在工作记录和日报里。
                </p>
              </div>
            </Card>
          </>
    </>
  );
}
