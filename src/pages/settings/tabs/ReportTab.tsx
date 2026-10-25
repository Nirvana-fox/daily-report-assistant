//! 设置页 · ReportTab（JSX 原样搬移自原 Settings.tsx，共享状态经 ctx 注入）
import { Trash2, Plus, Send } from 'lucide-react';
import { Input, Select } from '../../../components/Input';
import { pushRunNow } from '../../../api/ipc';
import Card from '../../../components/Card';
import Button from '../../../components/Button';
import type { SettingsCtx, SettingsCtxProps } from '../ctx';

export default function ReportTab({ ctx }: SettingsCtxProps) {
  return (
    <>
          <Card
            title="报告偏好"
            description="用于生成的默认值"
            hoverable={false}
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Select
                label="默认模板"
                value={ctx.draft.report.default_template}
                onChange={(e) =>
                  ctx.update('report', {
                    ...ctx.draft.report,
                    default_template: e.target.value,
                  })
                }
              >
                {ctx.templates.length === 0 ? (
                  <option value={ctx.draft.report.default_template}>
                    {ctx.draft.report.default_template || 'standard'}
                  </option>
                ) : (
                  ctx.templates.map((t) => (
                    <option key={t.key} value={t.key}>
                      {t.label}（{t.key}）
                    </option>
                  ))
                )}
              </Select>
              <Select
                label="语言"
                value={ctx.draft.report.language}
                onChange={(e) =>
                  ctx.update('report', {
                    ...ctx.draft.report,
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
                value={ctx.draft.report.user_name}
                onChange={(e) =>
                  ctx.update('report', {
                    ...ctx.draft.report,
                    user_name: e.target.value,
                  })
                }
              />
              <Input
                label="团队"
                value={ctx.draft.report.team}
                onChange={(e) =>
                  ctx.update('report', { ...ctx.draft.report, team: e.target.value })
                }
              />
            </div>
          </Card>

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
                    checked={ctx.draft.push?.enabled ?? false}
                    onChange={(e) =>
                      ctx.update('push', {
                        ...(ctx.draft.push ?? { enabled: false, daily_time: '18:30', daily_days: [1,2,3,4,5], weekly_enabled: false, weekly_day: 5, channels: [] }),
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
                  value={ctx.draft.push?.daily_time ?? '18:30'}
                  onChange={(e) =>
                    ctx.update('push', {
                      ...(ctx.draft.push ?? { enabled: false, daily_time: '18:30', daily_days: [1,2,3,4,5], weekly_enabled: false, weekly_day: 5, channels: [] }),
                      daily_time: e.target.value,
                    })
                  }
                />
                <div className="space-y-1.5">
                  <label className="label">日报推送日</label>
                  <div className="flex items-center gap-2 flex-wrap pt-1">
                    {['一','二','三','四','五','六','日'].map((d, i) => {
                      const day = i + 1;
                      const active = (ctx.draft.push?.daily_days ?? []).includes(day);
                      return (
                        <button
                          key={day}
                          type="button"
                          onClick={() => {
                            const cur = ctx.draft.push?.daily_days ?? [];
                            const next = active ? cur.filter((x) => x !== day) : [...cur, day].sort();
                            ctx.update('push', {
                              ...(ctx.draft.push ?? { enabled: false, daily_time: '18:30', daily_days: [1,2,3,4,5], weekly_enabled: false, weekly_day: 5, channels: [] }),
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
                      checked={ctx.draft.push?.weekly_enabled ?? false}
                      onChange={(e) =>
                        ctx.update('push', {
                          ...(ctx.draft.push ?? { enabled: false, daily_time: '18:30', daily_days: [1,2,3,4,5], weekly_enabled: false, weekly_day: 5, channels: [] }),
                          weekly_enabled: e.target.checked,
                        })
                      }
                      className="accent-primary"
                    />
                    同时推送周报（每周）
                  </label>
                  <Select
                    value={String(ctx.draft.push?.weekly_day ?? 5)}
                    onChange={(e) =>
                      ctx.update('push', {
                        ...(ctx.draft.push ?? { enabled: false, daily_time: '18:30', daily_days: [1,2,3,4,5], weekly_enabled: false, weekly_day: 5, channels: [] }),
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
                  loading={ctx.pushTesting}
                  onClick={async () => {
                    ctx.setPushTesting(true);
                    try {
                      await ctx.save(ctx.draft);
                      const st = await pushRunNow(true);
                      const ok = st.deliveries.filter(([, ok2]) => ok2).length;
                      const fail = st.deliveries.length - ok;
                      if (st.deliveries.length === 0) {
                        ctx.toast.error('没有启用的推送渠道，请先添加渠道');
                      } else if (fail === 0) {
                        ctx.toast.success(`推送成功（${ok} 个渠道），报告已存入报告库`);
                      } else {
                        const detail = st.deliveries.map(([c, o, m]) => `${c}: ${o ? 'OK' : m}`).join('\n');
                        ctx.toast.alert(`成功 ${ok} / 失败 ${fail}\n${detail}`, { title: '推送结果', kind: fail > 0 ? 'error' : 'success' });
                      }
                    } catch (e: any) {
                      ctx.toast.error(`推送失败: ${e}`);
                    } finally {
                      ctx.setPushTesting(false);
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
              {(ctx.draft.push?.channels ?? []).length === 0 ? (
                <div className="text-sm text-ink2 py-2 mb-2">还没有渠道，点下方按钮添加。</div>
              ) : (
                <div className="space-y-3 mb-3">
                  {(ctx.draft.push?.channels ?? []).map((ch, idx) => (
                    <div key={idx} className="border border-border rounded-pix p-3 space-y-2 bg-bg/30">
                      <div className="flex items-center gap-2">
                        <Select
                          value={ch.channel_type}
                          onChange={(e) => {
                            const channels = [...(ctx.draft.push?.channels ?? [])];
                            channels[idx] = { ...ch, channel_type: e.target.value };
                            ctx.update('push', { ...(ctx.draft.push ?? { enabled: false, daily_time: '18:30', daily_days: [1,2,3,4,5], weekly_enabled: false, weekly_day: 5, channels: [] }), channels });
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
                              const channels = [...(ctx.draft.push?.channels ?? [])];
                              channels[idx] = { ...ch, enabled: e.target.checked };
                              ctx.update('push', { ...(ctx.draft.push ?? { enabled: false, daily_time: '18:30', daily_days: [1,2,3,4,5], weekly_enabled: false, weekly_day: 5, channels: [] }), channels });
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
                            const channels = (ctx.draft.push?.channels ?? []).filter((_, i) => i !== idx);
                            ctx.update('push', { ...(ctx.draft.push ?? { enabled: false, daily_time: '18:30', daily_days: [1,2,3,4,5], weekly_enabled: false, weekly_day: 5, channels: [] }), channels });
                          }}
                        >
                          删除
                        </Button>
                      </div>
                      <Input
                        label="Webhook 地址"
                        value={ch.webhook_url}
                        onChange={(e) => {
                          const channels = [...(ctx.draft.push?.channels ?? [])];
                          channels[idx] = { ...ch, webhook_url: e.target.value };
                          ctx.update('push', { ...(ctx.draft.push ?? { enabled: false, daily_time: '18:30', daily_days: [1,2,3,4,5], weekly_enabled: false, weekly_day: 5, channels: [] }), channels });
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
                          const channels = [...(ctx.draft.push?.channels ?? [])];
                          channels[idx] = { ...ch, secret: e.target.value };
                          ctx.update('push', { ...(ctx.draft.push ?? { enabled: false, daily_time: '18:30', daily_days: [1,2,3,4,5], weekly_enabled: false, weekly_day: 5, channels: [] }), channels });
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
                    ...(ctx.draft.push?.channels ?? []),
                    { channel_type: 'feishu', webhook_url: '', secret: '', enabled: true },
                  ];
                  ctx.update('push', { ...(ctx.draft.push ?? { enabled: false, daily_time: '18:30', daily_days: [1,2,3,4,5], weekly_enabled: false, weekly_day: 5, channels: [] }), channels });
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
    </>
  );
}
