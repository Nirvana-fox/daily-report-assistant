//! 设置页 · PersonalTab（JSX 原样搬移自原 Settings.tsx，共享状态经 ctx 注入）
import { UserCog, ClipboardList } from 'lucide-react';
import Card from '../../../components/Card';
import Button from '../../../components/Button';
import type { SettingsCtx, SettingsCtxProps } from '../ctx';

export default function PersonalTab({ ctx }: SettingsCtxProps) {
  return (
    <>
          <>
            <Card
              title="我的资料"
              description="只由你主动维护，用于帮助 AI 理解你的人名、组织、项目和长期工作背景；保存在本地，只会在相关 AI 功能中按需使用"
              hoverable={false}
            >
              {(() => {
                const pf = ctx.draft.profile;
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
                        ctx.setProfileDraft(
                          structuredClone(ctx.draft.profile ?? {
                            display_name: '', aliases: '', role: '', org: '',
                            projects: '', responsibilities: '', collaborators: '', extra: '',
                          })
                        );
                        ctx.setShowProfileModal(true);
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
              {ctx.draft.report.custom_instructions?.trim() ? (
                <div className="bg-bg-soft border border-border rounded-pix p-3 text-sm text-ink whitespace-pre-wrap mb-3 line-clamp-6">
                  {ctx.draft.report.custom_instructions}
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
                  ctx.setCustomDraft(ctx.draft.report.custom_instructions ?? '');
                  ctx.setShowCustomModal(true);
                }}
              >
                {ctx.draft.report.custom_instructions?.trim() ? '编辑指令' : '设置指令'}
              </Button>
            </Card>
          </>
    </>
  );
}
