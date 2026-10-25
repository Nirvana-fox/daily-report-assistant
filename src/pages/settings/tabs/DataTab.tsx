//! 设置页 · DataTab（JSX 原样搬移自原 Settings.tsx，共享状态经 ctx 注入）
import { Save, CheckCircle2, FolderOpen, Plug, Trash2, ListTree, AlertTriangle, RefreshCw, Download, UploadCloud, Folder } from 'lucide-react';
import { Input } from '../../../components/Input';
import { openPath } from '@tauri-apps/plugin-opener';
import Card from '../../../components/Card';
import Button from '../../../components/Button';
import dayjs from 'dayjs';
import { Stat } from '../components';
import type { SettingsCtx, SettingsCtxProps } from '../ctx';

export default function DataTab({ ctx }: SettingsCtxProps) {
  return (
    <>
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
                    checked={ctx.draft.nas?.enabled ?? false}
                    onChange={(e) =>
                      ctx.update('nas', {
                        ...(ctx.draft.nas ?? { enabled: false, base_url: '', token: '', device_id: '', device_name: '', sync_images: true, sync_interval_seconds: 30 }),
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
                  value={ctx.draft.nas?.sync_interval_seconds ?? 30}
                  onChange={(e) =>
                    ctx.update('nas', {
                      ...(ctx.draft.nas ?? { enabled: false, base_url: '', token: '', device_id: '', device_name: '', sync_images: true, sync_interval_seconds: 30 }),
                      sync_interval_seconds: Number(e.target.value),
                    })
                  }
                />
                <Input
                  label="服务端地址"
                  value={ctx.draft.nas?.base_url ?? ''}
                  onChange={(e) =>
                    ctx.update('nas', {
                      ...(ctx.draft.nas ?? { enabled: false, base_url: '', token: '', device_id: '', device_name: '', sync_images: true, sync_interval_seconds: 30 }),
                      base_url: e.target.value,
                    })
                  }
                  placeholder="http://192.168.1.100:8088"
                  hint="NAS 的 IP + 服务端口"
                />
                <Input
                  label="访问令牌"
                  type="password"
                  value={ctx.draft.nas?.token ?? ''}
                  onChange={(e) =>
                    ctx.update('nas', {
                      ...(ctx.draft.nas ?? { enabled: false, base_url: '', token: '', device_id: '', device_name: '', sync_images: true, sync_interval_seconds: 30 }),
                      token: e.target.value,
                    })
                  }
                  placeholder="与服务端 TOKEN 一致；留空表示不鉴权"
                />
                <Input
                  label="设备 ID"
                  value={ctx.draft.nas?.device_id ?? ''}
                  onChange={(e) =>
                    ctx.update('nas', {
                      ...(ctx.draft.nas ?? { enabled: false, base_url: '', token: '', device_id: '', device_name: '', sync_images: true, sync_interval_seconds: 30 }),
                      device_id: e.target.value,
                    })
                  }
                  placeholder="留空自动取主机名"
                  hint="多台电脑同步时用于区分来源"
                />
                <Input
                  label="设备名称"
                  value={ctx.draft.nas?.device_name ?? ''}
                  onChange={(e) =>
                    ctx.update('nas', {
                      ...(ctx.draft.nas ?? { enabled: false, base_url: '', token: '', device_id: '', device_name: '', sync_images: true, sync_interval_seconds: 30 }),
                      device_name: e.target.value,
                    })
                  }
                  placeholder="例如：台式机 / 笔记本"
                />
                <label className="flex items-center gap-2 text-sm self-end pb-2 text-ink">
                  <input
                    type="checkbox"
                    checked={ctx.draft.nas?.sync_images ?? true}
                    onChange={(e) =>
                      ctx.update('nas', {
                        ...(ctx.draft.nas ?? { enabled: false, base_url: '', token: '', device_id: '', device_name: '', sync_images: true, sync_interval_seconds: 30 }),
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
                  onClick={() => void ctx.onNasTest()}
                  loading={ctx.nasTesting}
                >
                  保存并测试连接
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<RefreshCw size={14} />}
                  onClick={() => void ctx.onNasSync()}
                  loading={ctx.nasSyncing}
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

          <>
          <Card
            title="数据存储位置"
            description="数据库与截图默认保存在用户目录；可整体迁移到任意位置（如 D 盘或 NAS 挂载盘）"
            hoverable={false}
          >
            <div className="space-y-2 mb-3">
              <div className="flex items-start gap-2 text-sm">
                <span className="text-ink2 w-20 shrink-0">数据库</span>
                <span className="text-ink font-mono text-xs break-all bg-bg-soft rounded-pix px-2 py-1 flex-1">
                  {ctx.dStats?.db_path || '—'}
                </span>
              </div>
              <div className="flex items-start gap-2 text-sm">
                <span className="text-ink2 w-20 shrink-0">截图目录</span>
                <span className="text-ink font-mono text-xs break-all bg-bg-soft rounded-pix px-2 py-1 flex-1">
                  {ctx.dStats?.screenshot_dir || '—'}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Button
                variant="secondary"
                size="sm"
                icon={<Folder size={13} />}
                onClick={() => {
                  if (ctx.dStats?.db_path)
                    void openPath(ctx.dStats.db_path).catch((e) => ctx.toast.error(`打开失败: ${e}`));
                }}
              >
                打开数据目录
              </Button>
              <Button
                variant="secondary"
                size="sm"
                icon={<Folder size={13} />}
                onClick={() => {
                  if (ctx.dStats?.screenshot_dir)
                    void openPath(ctx.dStats.screenshot_dir).catch((e) =>
                      ctx.toast.error(`打开失败: ${e}`)
                    );
                }}
              >
                打开截图目录
              </Button>
              <Button
                size="sm"
                icon={<FolderOpen size={13} />}
                loading={ctx.moving}
                onClick={() => void ctx.onMoveData()}
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
                checked={ctx.purgeFiles}
                onChange={(e) => ctx.setPurgeFiles(e.target.checked)}
                className="accent-primary"
              />
              清理工作记录时同时删除引用的截图文件（关闭则仅删记录、保留文件与路径）
            </label>
            <div className="divide-y divide-border border border-border rounded-md">
              {([
                ['work_logs', '工作记录', ctx.dStats?.work_logs],
                ['reports', '报告', ctx.dStats?.reports],
                ['todos', '待办', ctx.dStats?.todos],
                ['plan_tasks', '规划任务', ctx.dStats?.plan_tasks],
                ['assistant_messages', 'AI 对话', ctx.dStats?.assistant_messages],
                ['app_usage_sessions', '应用时长会话', ctx.dStats?.app_usage_sessions],
              ] as const).map(([cat, label, count]) => (
                <div key={cat} className="flex items-center gap-3 px-3 py-2">
                  <span className="text-sm text-ink flex-1">{label}</span>
                  <span className="text-sm text-ink2 font-mono">{count ?? '—'} 条</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={<Trash2 size={13} />}
                    loading={ctx.purgingCat === cat}
                    onClick={() => void ctx.onPurgeCategory(cat, label, null)}
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
                  {ctx.dStats ? `${ctx.dStats.screenshots.file_count} 个 · ${ctx.fmtBytes(ctx.dStats.screenshots.total_bytes)}` : '—'}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<Trash2 size={13} />}
                  loading={ctx.purgingCat === 'screenshots'}
                  onClick={() => void ctx.onPurgeCategory('screenshots', '截图文件', null)}
                >
                  清空
                </Button>
              </div>
            </div>
            <div className="mt-3 text-xs text-ink2">
              数据库大小：{ctx.dStats ? ctx.fmtBytes(ctx.dStats.db_bytes) : '—'} · 截图保存目录在「截图」页设置
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
                  value={ctx.expPwd}
                  onChange={(e) => ctx.setExpPwd(e.target.value)}
                  placeholder="用于加密，忘记将无法恢复"
                />
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<Download size={13} />}
                  loading={ctx.backupBusy === 'export'}
                  disabled={!ctx.expPwd}
                  onClick={() => void ctx.onExport()}
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
                  value={ctx.impPwd}
                  onChange={(e) => ctx.setImpPwd(e.target.value)}
                  placeholder="该备份文件的密码"
                />
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<UploadCloud size={13} />}
                  loading={ctx.backupBusy === 'import'}
                  disabled={!ctx.impPwd}
                  onClick={() => void ctx.onImport()}
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
                value={ctx.stats?.work_logs_total ?? '—'}
              />
              <Stat
                icon={<CheckCircle2 size={18} className="text-primary-600" />}
                label="报告数"
                value={ctx.stats?.reports_total ?? '—'}
              />
              <Stat
                icon={<Save size={18} className="text-accent-600" />}
                label="时间范围"
                value={
                  ctx.stats?.earliest_log
                    ? `${dayjs(ctx.stats.earliest_log).format('YY-MM-DD')} ~ ${dayjs(
                        ctx.stats.latest_log
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
                value={ctx.purgeDays}
                onChange={(e) => ctx.setPurgeDays(Number(e.target.value))}
                className="w-[200px]"
              />
              <Button
                variant="secondary"
                icon={<Trash2 size={14} />}
                onClick={() => void ctx.onPurgeBefore()}
                loading={ctx.purging}
              >
                清理早于 {ctx.purgeDays} 天的数据
              </Button>
              <Button
                variant="danger"
                icon={<Trash2 size={14} />}
                onClick={() => void ctx.onPurgeAll()}
                loading={ctx.purging}
              >
                清空全部
              </Button>
            </div>
          </Card>
          </>
    </>
  );
}
