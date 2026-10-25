//! 设置页 · GeneralTab（JSX 原样搬移自原 Settings.tsx，共享状态经 ctx 注入）
import { Lock } from 'lucide-react';
import { Input, Textarea } from '../../../components/Input';
import { accountChangePassword, accountSetEnabled, accountSetup, accountStatus } from '../../../api/ipc';
import Card from '../../../components/Card';
import Button from '../../../components/Button';
import dayjs from 'dayjs';
import type { SettingsCtx, SettingsCtxProps } from '../ctx';

export default function GeneralTab({ ctx }: SettingsCtxProps) {
  return (
    <>
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
                    checked={ctx.draft.app.auto_launch_on_boot}
                    onChange={(e) =>
                      ctx.update('app', {
                        ...ctx.draft.app,
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
                    checked={ctx.draft.app.silent_launch}
                    onChange={(e) =>
                      ctx.update('app', {
                        ...ctx.draft.app,
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
                  value={ctx.draft.app.cleanup_keep_days}
                  onChange={(e) =>
                    ctx.update('app', {
                      ...ctx.draft.app,
                      cleanup_keep_days: Number(e.target.value),
                    })
                  }
                />
                <Input
                  label="数据库路径"
                  value={ctx.draft.db_path}
                  onChange={(e) => ctx.update('db_path', e.target.value)}
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
                    checked={ctx.draft.git?.enabled ?? false}
                    onChange={(e) =>
                      ctx.update('git', {
                        ...(ctx.draft.git ?? { enabled: false, repos: [], author_emails: [], author_names: [], poll_interval_seconds: 600 }),
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
                  value={ctx.draft.git?.poll_interval_seconds ?? 600}
                  onChange={(e) =>
                    ctx.update('git', {
                      ...(ctx.draft.git ?? { enabled: false, repos: [], author_emails: [], author_names: [], poll_interval_seconds: 600 }),
                      poll_interval_seconds: Number(e.target.value),
                    })
                  }
                />
                <Textarea
                  label="仓库目录（每行一个绝对路径）"
                  rows={3}
                  value={(ctx.draft.git?.repos ?? []).join('\n')}
                  onChange={(e) =>
                    ctx.update('git', {
                      ...(ctx.draft.git ?? { enabled: false, repos: [], author_emails: [], author_names: [], poll_interval_seconds: 600 }),
                      repos: e.target.value.split('\n').map((x) => x.trim()).filter(Boolean),
                    })
                  }
                  placeholder={'D:\\work\\project-a\nD:\\work\\project-b'}
                />
                <Textarea
                  label="我的提交邮箱（每行一个，留空不过滤）"
                  rows={3}
                  value={(ctx.draft.git?.author_emails ?? []).join('\n')}
                  onChange={(e) =>
                    ctx.update('git', {
                      ...(ctx.draft.git ?? { enabled: false, repos: [], author_emails: [], author_names: [], poll_interval_seconds: 600 }),
                      author_emails: e.target.value.split('\n').map((x) => x.trim()).filter(Boolean),
                    })
                  }
                  placeholder={'me@company.com\nme@personal.com'}
                />
                <Textarea
                  label="我的提交姓名（每行一个，与邮箱任一匹配即可）"
                  rows={2}
                  value={(ctx.draft.git?.author_names ?? []).join('\n')}
                  onChange={(e) =>
                    ctx.update('git', {
                      ...(ctx.draft.git ?? { enabled: false, repos: [], author_emails: [], author_names: [], poll_interval_seconds: 600 }),
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
                  value={ctx.draft.todo?.hotkey ?? 'Alt+Space'}
                  onChange={(e) =>
                    ctx.update('todo', {
                      ...(ctx.draft.todo ?? { hotkey: 'Alt+Space' }),
                      hotkey: e.target.value,
                    })
                  }
                  placeholder="Alt+Space"
                  hint="默认 Alt+Space · 格式如 Alt+Space / CommandOrControl+Shift+T"
                />
                <Input
                  label="切换本地模型分析"
                  value={ctx.draft.shortcuts?.local_llm_toggle ?? 'Ctrl+Alt+L'}
                  onChange={(e) =>
                    ctx.update('shortcuts', {
                      ...(ctx.draft.shortcuts ?? { local_llm_toggle: 'Ctrl+Alt+L' }),
                      local_llm_toggle: e.target.value,
                    })
                  }
                  placeholder="Ctrl+Alt+L"
                  hint="随时把截图分析在 云端/本地 大模型间一键切换"
                />
              </div>
            </Card>
          </>

          <>
            <Card
              title="本地账号"
              description={
                ctx.acct
                  ? ctx.acct.has_account
                    ? `账号：${ctx.acct.username ?? '-'} · 登录${ctx.acct.enabled ? '已启用（启动应用需输入密码）' : '未启用'}`
                    : '尚未创建账号。创建后可启用启动登录，保护本地数据'
                  : '加载中...'
              }
              hoverable={false}
            >
              {!ctx.acct?.has_account ? (
                <div className="space-y-3 max-w-md">
                  <Input label="用户名" value={ctx.acctUser} onChange={(e) => ctx.setAcctUser(e.target.value)} placeholder="例如：风雅" />
                  <Input label="密码（至少 4 位）" type="password" value={ctx.acctNewPwd} onChange={(e) => ctx.setAcctNewPwd(e.target.value)} />
                  <Input label="确认密码" type="password" value={ctx.acctNewPwd2} onChange={(e) => ctx.setAcctNewPwd2(e.target.value)} />
                  <Button
                    size="sm"
                    icon={<Lock size={13} />}
                    loading={ctx.acctBusy}
                    disabled={!ctx.acctUser || !ctx.acctNewPwd || ctx.acctNewPwd !== ctx.acctNewPwd2}
                    onClick={async () => {
                      ctx.setAcctBusy(true);
                      try {
                        await accountSetup(ctx.acctUser, ctx.acctNewPwd);
                        ctx.toast.success('账号已创建，登录已启用（下次启动生效）');
                        ctx.setAcct(await accountStatus());
                        ctx.setAcctNewPwd('');
                        ctx.setAcctNewPwd2('');
                      } catch (e: any) {
                        ctx.toast.error(`创建失败: ${e}`);
                      } finally {
                        ctx.setAcctBusy(false);
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
                    <Input label="旧密码" type="password" value={ctx.acctOldPwd} onChange={(e) => ctx.setAcctOldPwd(e.target.value)} />
                    <Input label="新密码（至少 4 位）" type="password" value={ctx.acctNewPwd} onChange={(e) => ctx.setAcctNewPwd(e.target.value)} />
                    <Input label="确认新密码" type="password" value={ctx.acctNewPwd2} onChange={(e) => ctx.setAcctNewPwd2(e.target.value)} />
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={ctx.acctBusy}
                      disabled={!ctx.acctOldPwd || !ctx.acctNewPwd || ctx.acctNewPwd !== ctx.acctNewPwd2}
                      onClick={async () => {
                        ctx.setAcctBusy(true);
                        try {
                          await accountChangePassword(ctx.acctOldPwd, ctx.acctNewPwd);
                          ctx.toast.success('密码已修改');
                          ctx.setAcctOldPwd('');
                          ctx.setAcctNewPwd('');
                          ctx.setAcctNewPwd2('');
                        } catch (e: any) {
                          ctx.toast.error(`修改失败: ${e}`);
                        } finally {
                          ctx.setAcctBusy(false);
                        }
                      }}
                    >
                      修改密码
                    </Button>
                  </div>
                  <div className="space-y-2 pt-3 border-t border-border">
                    <div className="text-sm font-medium text-ink">
                      启动登录：{ctx.acct.enabled ? '已启用' : '未启用'}
                    </div>
                    <div className="flex items-center gap-2">
                      <Input
                        label="输入密码以更改开关"
                        type="password"
                        value={ctx.acctTogglePwd}
                        onChange={(e) => ctx.setAcctTogglePwd(e.target.value)}
                        className="flex-1"
                      />
                      <Button
                        variant={ctx.acct.enabled ? 'danger' : 'secondary'}
                        size="sm"
                        loading={ctx.acctBusy}
                        disabled={!ctx.acctTogglePwd}
                        onClick={async () => {
                          ctx.setAcctBusy(true);
                          try {
                            await accountSetEnabled(!ctx.acct.enabled, ctx.acctTogglePwd);
                            ctx.toast.success(ctx.acct.enabled ? '已关闭启动登录' : '已启用启动登录');
                            ctx.setAcct(await accountStatus());
                            ctx.setAcctTogglePwd('');
                          } catch (e: any) {
                            ctx.toast.error(`操作失败: ${e}`);
                          } finally {
                            ctx.setAcctBusy(false);
                          }
                        }}
                      >
                        {ctx.acct.enabled ? '关闭启动登录' : '启用启动登录'}
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

          <>
            <Card title="关于" description="版本、介绍与开发者信息" hoverable={false}>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                <div className="bg-bg-soft rounded-pix p-3 border border-border">
                  <div className="text-xs text-ink2">版本号</div>
                  <div className="text-lg font-semibold text-ink mt-1">v1.7.3</div>
                </div>
                <div className="bg-bg-soft rounded-pix p-3 border border-border">
                  <div className="text-xs text-ink2">更新日期</div>
                  <div className="text-lg font-semibold text-ink mt-1">2026-09-19</div>
                </div>
                <div className="bg-bg-soft rounded-pix p-3 border border-border">
                  <div className="text-xs text-ink2">框架</div>
                  <div className="text-lg font-semibold text-ink mt-1">Tauri v2</div>
                </div>
              </div>
              <div className="space-y-3 text-sm text-ink">
                <p>
                  日报助手是一款基于 AI 的智能工作记录与报告生成工具：定时截图 + AI 理解自动记录工作，
                  生成日报/周报；支持自选模型（云端/本地 Ollama）、自托管 NAS 同步、可审计的隐私脱敏与加密备份。
                </p>
                <div className="flex flex-wrap gap-2">
                  {['自动截图', 'AI 分析', '本地模型', 'OCR 两段式', '隐私脱敏', 'NAS 自托管', '加密备份', '报告推送'].map((t) => (
                    <span key={t} className="px-2 py-1 text-[11px] bg-primary-50 text-primary-700 rounded-pix border border-primary-200">{t}</span>
                  ))}
                </div>
                <p className="text-ink2">
                  完整操作说明见{' '}
                  <button className="text-primary-700 hover:underline" onClick={() => ctx.navigate('/manual')}>
                    使用手册
                  </button>
                  。
                </p>
                <details className="mt-2 text-xs text-ink2">
                  <summary className="cursor-pointer select-none text-ink">开发者信息（结构 / 逻辑 / 技术栈）</summary>
                  <div className="mt-2 space-y-2">
                    <p>结构：Tauri v2 + React 18 前端；Rust workspace（crates/core 采集与 LLM，src-tauri 命令层）；SQLite 本地存储。</p>
                    <p>逻辑：监听循环每轮 截图 → dHash 去重 → 视觉/OCR 分析 → 脱敏入库；报告生成按模板汇总记录交 LLM 扩写。</p>
                    <p>技术栈：Rust / tokio / reqwest / rusqlite / libgit2 / xcap；React / TypeScript / Tailwind / dayjs。</p>
                  </div>
                </details>
              </div>
            </Card>
          </>

        {/* 我的资料弹窗 */}
    </>
  );
}
