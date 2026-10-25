import { useCallback, useEffect, useState } from 'react';
import dayjs from 'dayjs';
import {
  Users,
  Server,
  KeyRound,
  ListTodo,
  FileEdit,
  FileText,
  RefreshCw,
  Send,
  Sparkles,
  Check,
  Crown,
} from 'lucide-react';
import Card from '../components/Card';
import Button from '../components/Button';
import { useConfig } from '../hooks/useConfig';
import { useToast } from '../hooks/useToast';
import type { TeamConfig } from '../api/types';
import {
  checklistGenerate,
  checklistGet,
  dailyReport,
  dailyReportPush,
  getTeamConfig,
  membersList,
  submissionGet,
  submissionUpsert,
  submissionsDay,
  taskAbandon,
  taskAutoAssign,
  taskClaim,
  taskComplete,
  taskCreate,
  tasksList,
  teamCreate,
  teamHealth,
  teamJoin,
  type DaySubmissions,
  type TeamMember,
  type TeamSubmission,
  type TeamTask,
} from '../api/team';
import clsx from 'clsx';

type TeamTab = 'overview' | 'tasks' | 'submission' | 'report';

/** 团队页（企业版）：团队空间 / 任务池 / 每日提报 / 团队日报 */
export default function Team() {
  const toast = useToast();
  const { config, save } = useConfig();
  const [team, setTeam] = useState<TeamConfig | null>(null);
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);

  // 连接表单
  const [baseUrl, setBaseUrl] = useState('');
  const [mode, setMode] = useState<'create' | 'join'>('join');
  const [teamName, setTeamName] = useState('');
  const [memberName, setMemberName] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [createdInvite, setCreatedInvite] = useState('');

  // 工作台
  const [tab, setTab] = useState<TeamTab>('overview');
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [tasks, setTasks] = useState<TeamTask[]>([]);
  const [dayData, setDayData] = useState<DaySubmissions | null>(null);
  const [mySubmission, setMySubmission] = useState<TeamSubmission | null>(null);
  const [freeText, setFreeText] = useState('');
  const [checklistHint, setChecklistHint] = useState('');
  const [reportText, setReportText] = useState('');
  const [pushUrl, setPushUrl] = useState('');
  const [pushChannel, setPushChannel] = useState('feishu');
  const [newTask, setNewTask] = useState({ title: '', description: '', priority: 'medium' });
  const [busy, setBusy] = useState<string | null>(null);

  const cfgOf = useCallback(async () => {
    const t = await getTeamConfig();
    setTeam(t);
    setBaseUrl(t.base_url);
    return t;
  }, []);

  useEffect(() => {
    void (async () => {
      const t = await cfgOf();
      if (t.base_url && t.token) {
        setConnected(true);
        setMemberName((n) => n || t.member_name);
      }
    })();
  }, [cfgOf]);

  const today = dayjs().format('YYYY-MM-DD');

  const refreshAll = useCallback(
    async (t: TeamConfig) => {
      try {
        const [m, tk, day, mine] = await Promise.all([
          membersList(t),
          tasksList(t),
          submissionsDay(t, today),
          submissionGet(t, today),
        ]);
        setMembers(m);
        setTasks(tk);
        setDayData(day);
        setMySubmission(mine);
        if (mine) setFreeText(mine.free_text);
      } catch (e: any) {
        toast.error(`加载团队数据失败: ${e}`);
      }
    },
    [toast, today]
  );

  useEffect(() => {
    if (connected && team?.token) void refreshAll(team);
  }, [connected, team, refreshAll]);

  /** 保存连接信息到 config */
  const persist = async (patch: Partial<TeamConfig>) => {
    if (!config) return;
    const next = {
      ...config,
      team: { ...(config.team ?? { base_url: '', token: '', team_name: '', member_name: '' }), ...patch },
    };
    await save(next);
  };

  const onTest = async () => {
    setConnecting(true);
    try {
      const t = { ...(team ?? { base_url: '', token: '', team_name: '', member_name: '' }), base_url: baseUrl.trim() };
      const h = await teamHealth(t);
      toast.success(`服务端连通（${h.service ?? 'team-server'}）`);
    } catch (e: any) {
      toast.error(`连接失败: ${e}`);
    } finally {
      setConnecting(false);
    }
  };

  const onJoin = async () => {
    if (!baseUrl.trim() || !memberName.trim() || (mode === 'join' ? !inviteCode.trim() : !teamName.trim())) {
      toast.error('请填写服务端地址、成员名' + (mode === 'join' ? '和邀请码' : '和团队名'));
      return;
    }
    setConnecting(true);
    try {
      const t: TeamConfig = { base_url: baseUrl.trim(), token: '', team_name: '', member_name: memberName.trim() };
      const r: { team_id: number; invite_code?: string; member: { id: number; name: string; token: string; is_creator: boolean } } =
        mode === 'create'
          ? await teamCreate(t, teamName.trim(), memberName.trim())
          : await teamJoin(t, inviteCode.trim(), memberName.trim());
      await persist({
        base_url: t.base_url,
        token: r.member.token,
        team_name: teamName.trim() || '我的团队',
        member_name: r.member.name,
      });
      if (mode === 'create') setCreatedInvite(r.invite_code ?? '');
      toast.success(mode === 'create' ? '团队已创建' : '已加入团队');
      const nt = { ...t, token: r.member.token, team_name: teamName.trim(), member_name: r.member.name };
      setTeam(nt);
      setConnected(true);
      await refreshAll(nt);
    } catch (e: any) {
      toast.error(`${e}`);
    } finally {
      setConnecting(false);
    }
  };

  const onLeave = async () => {
    await persist({ token: '', team_name: '' });
    setConnected(false);
    toast.info('已断开团队（成员记录仍保留在服务端）');
  };

  // ---- 任务池 ----
  const onTaskAction = async (key: string, fn: () => Promise<unknown>, okMsg: string) => {
    setBusy(key);
    try {
      await fn();
      toast.success(okMsg);
      if (team) await refreshAll(team);
    } catch (e: any) {
      toast.error(`${e}`);
    } finally {
      setBusy(null);
    }
  };

  const onCreateTask = async () => {
    if (!newTask.title.trim()) {
      toast.error('任务标题不能为空');
      return;
    }
    setBusy('newtask');
    try {
      await taskCreate(team!, { title: newTask.title.trim(), description: newTask.description, priority: newTask.priority });
      toast.success('任务已入池');
      setNewTask({ title: '', description: '', priority: 'medium' });
      await refreshAll(team!);
    } catch (e: any) {
      toast.error(`${e}`);
    } finally {
      setBusy(null);
    }
  };

  // ---- 每日提报 ----
  const onGenChecklist = async () => {
    setBusy('checklist');
    try {
      const cl = await checklistGenerate(team!, today);
      setChecklistHint(
        (cl.items ?? []).map((i) => `· ${i.title ?? i.hint ?? ''}`).join('\n') || '清单为空'
      );
      toast.success('已生成"该交什么"清单');
    } catch (e: any) {
      toast.error(`${e}`);
    } finally {
      setBusy(null);
    }
  };

  const onSubmitReport = async () => {
    if (!freeText.trim()) {
      toast.error('提报内容不能为空');
      return;
    }
    setBusy('submit');
    try {
      await submissionUpsert(team!, { date: today, task_items: [], free_text: freeText.trim() });
      toast.success('今日提报已保存（24 小时内可修改）');
      if (team) await refreshAll(team);
    } catch (e: any) {
      toast.error(`${e}`);
    } finally {
      setBusy(null);
    }
  };

  // ---- 团队日报 ----
  const onGenReport = async () => {
    setBusy('report');
    try {
      const r = await dailyReport(team!, today);
      const subs = r.submissions ?? [];
      setReportText(
        `【团队日报 ${today}】\n提交：${subs.length} 人\n` +
          subs
            .map((s) => `\n◆ ${s.member_name ?? '成员'}\n${s.free_text || '（无正文）'}`)
            .join('\n') +
          `\n\n未提交：${(r.missing ?? []).map((m) => m.name).join('、') || '无'}`
      );
    } catch (e: any) {
      toast.error(`${e}`);
    } finally {
      setBusy(null);
    }
  };

  const onPushReport = async () => {
    if (!pushUrl.trim()) {
      toast.error('请先填 Webhook 地址');
      return;
    }
    setBusy('push');
    try {
      await dailyReportPush(team!, { date: today, channel_type: pushChannel, webhook_url: pushUrl.trim() });
      toast.success('团队日报已推送');
    } catch (e: any) {
      toast.error(`${e}`);
    } finally {
      setBusy(null);
    }
  };

  // ==================== 未连接：引导页 ====================
  if (!connected) {
    return (
      <div className="p-5 lg:p-6 space-y-4 max-w-[640px]">
        <header>
          <h1 className="text-xl font-semibold text-ink text-pix flex items-center gap-2">
            <Users size={20} className="text-primary-600" />
            团队
          </h1>
          <p className="text-xs text-ink2 mt-0.5">
            企业版功能：团队空间 · 任务池 · 每日提报 · 团队日报（成员对等、无等级）
          </p>
        </header>

        <Card title="连接团队服务端" description="一次部署，全员共用（数据存在你自己的服务器上）">
          <div className="space-y-3">
            <label className="block">
              <span className="label !mb-1">服务端地址</span>
              <div className="flex gap-2">
                <input
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="http://192.168.1.10:8090"
                  className="input-base flex-1"
                />
                <Button variant="secondary" icon={<Server size={14} />} onClick={() => void onTest()} loading={connecting}>
                  测试
                </Button>
              </div>
            </label>

            <div className="flex rounded-pix border border-border bg-bg-soft p-0.5 w-fit">
              {(
                [
                  { key: 'join', label: '凭邀请码加入' },
                  { key: 'create', label: '创建新团队' },
                ] as const
              ).map((m) => (
                <button
                  key={m.key}
                  type="button"
                  onClick={() => setMode(m.key)}
                  className={clsx(
                    'px-3 py-1.5 text-xs font-medium rounded-pix transition-all',
                    mode === m.key ? 'bg-card text-primary-700 shadow-pix' : 'text-ink2 hover:text-ink'
                  )}
                >
                  {m.label}
                </button>
              ))}
            </div>

            {mode === 'join' ? (
              <label className="block">
                <span className="label !mb-1">邀请码</span>
                <div className="flex gap-2">
                  <input
                    value={inviteCode}
                    onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                    placeholder="如 A1B2C3D4"
                    className="input-base flex-1 font-mono"
                  />
                  <KeyRound size={16} className="self-center text-ink2" />
                </div>
              </label>
            ) : (
              <label className="block">
                <span className="label !mb-1">团队名</span>
                <input
                  value={teamName}
                  onChange={(e) => setTeamName(e.target.value)}
                  placeholder="如：产品研发组"
                  className="input-base"
                />
              </label>
            )}

            <label className="block">
              <span className="label !mb-1">我的名字</span>
              <input
                value={memberName}
                onChange={(e) => setMemberName(e.target.value)}
                placeholder="团队成员里显示的名字"
                className="input-base"
              />
            </label>

            <Button
              variant="primary"
              className="w-full"
              icon={<Users size={14} />}
              onClick={() => void onJoin()}
              loading={connecting}
            >
              {mode === 'create' ? '创建团队' : '加入团队'}
            </Button>

            {createdInvite && (
              <div className="p-3 rounded-pix bg-primary-50 border border-primary-100 text-sm">
                团队已创建！邀请码：
                <b className="font-mono text-primary-700 tracking-widest">{createdInvite}</b>
                <div className="text-xs text-ink2 mt-1">把它发给同事，他们在「加入团队」里填这个码即可。</div>
              </div>
            )}

            <p className="text-[11px] text-ink2">
              还没部署服务端？仓库 <code className="px-1 bg-bg2 rounded">team-server/</code> 目录一条
              <code className="px-1 bg-bg2 rounded">docker compose up -d</code> 即可（详见 team-server/README.md）。
            </p>
          </div>
        </Card>
      </div>
    );
  }

  // ==================== 已连接：工作台 ====================
  const openTasks = tasks.filter((t) => t.status !== 'done');
  const myId = members.find((m) => m.name === team?.member_name)?.id;

  return (
    <div className="p-5 lg:p-6 space-y-4">
      <header className="flex items-center gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-ink text-pix flex items-center gap-2">
            <Users size={20} className="text-primary-600" />
            {team?.team_name || '团队'}
          </h1>
          <p className="text-xs text-ink2 mt-0.5">
            {team?.base_url} · 我是 {team?.member_name} ·{' '}
            <button onClick={() => void onLeave()} className="hover:underline hover:text-ink">
              断开
            </button>
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {mode === 'join' && createdInvite && (
            <span className="text-xs text-ink2">邀请码 {createdInvite}</span>
          )}
          <Button
            variant="ghost"
            size="sm"
            icon={<RefreshCw size={14} />}
            onClick={() => team && void refreshAll(team)}
          >
            刷新
          </Button>
        </div>
      </header>

      {/* Tab 栏 */}
      <div className="flex rounded-pix border border-border bg-card p-0.5 w-fit flex-wrap">
        {(
          [
            { key: 'overview', label: '团队概览', icon: Users },
            { key: 'tasks', label: '任务池', icon: ListTodo },
            { key: 'submission', label: '每日提报', icon: FileEdit },
            { key: 'report', label: '团队日报', icon: FileText },
          ] as const
        ).map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={clsx(
              'flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium rounded-pix transition-all',
              tab === t.key ? 'bg-primary-50 text-primary-700' : 'text-ink2 hover:text-ink'
            )}
          >
            <t.icon size={13} />
            {t.label}
          </button>
        ))}
      </div>

      {/* 团队概览 */}
      {tab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card title={`成员（${members.length}）`} description="成员对等，无等级">
            <ul className="divide-y divide-border">
              {members.map((m) => (
                <li key={m.id} className="py-2 flex items-center gap-2 text-sm">
                  <span className="text-ink">{m.name}</span>
                  {!!m.is_creator && (
                    <span title="创建者" className="inline-flex">
                      <Crown size={13} className="text-primary-600" />
                    </span>
                  )}
                  <span className="ml-auto text-[11px] text-ink2">
                    {dayjs(m.created_at).format('MM-DD 加入')}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
          <Card title={`今日提报（${dayData?.submissions?.length ?? 0}/${members.length}）`}>
            <div className="flex flex-wrap gap-1.5 mb-3">
              {members.map((m) => {
                const ok = dayData?.submissions?.some((s) => s.member_id === m.id);
                return (
                  <span
                    key={m.id}
                    className={clsx(
                      'text-xs px-2 py-1 rounded-pix border',
                      ok ? 'bg-primary-50 border-transparent text-primary-700' : 'border-border text-ink2'
                    )}
                  >
                    {ok ? '✓ ' : ''}
                    {m.name}
                  </span>
                );
              })}
            </div>
            <p className="text-xs text-ink2">
              未提交：{(dayData?.missing ?? []).map((m) => m.name).join('、') || '无'}
            </p>
          </Card>
        </div>
      )}

      {/* 任务池 */}
      {tab === 'tasks' && (
        <div className="space-y-4">
          <Card title="新建任务" description="入池后由成员自主认领，或一键按负载自动分配">
            <div className="flex gap-2 flex-wrap">
              <input
                value={newTask.title}
                onChange={(e) => setNewTask((t) => ({ ...t, title: e.target.value }))}
                placeholder="任务标题 *"
                className="input-base flex-1 min-w-[180px]"
              />
              <select
                value={newTask.priority}
                onChange={(e) => setNewTask((t) => ({ ...t, priority: e.target.value }))}
                className="input-base w-24"
              >
                <option value="high">高</option>
                <option value="medium">中</option>
                <option value="low">低</option>
              </select>
              <Button
                variant="primary"
                icon={<Sparkles size={14} />}
                onClick={() => void onCreateTask()}
                loading={busy === 'newtask'}
              >
                入池
              </Button>
              <Button
                variant="secondary"
                onClick={() => void onTaskAction('auto', () => taskAutoAssign(team!), '已按负载自动分配未认领任务')}
                loading={busy === 'auto'}
              >
                自动分配
              </Button>
            </div>
          </Card>

          <Card title={`任务池（${openTasks.length} 个进行中）`}>
            {openTasks.length === 0 ? (
              <div className="py-8 text-center text-sm text-ink2">任务池是空的</div>
            ) : (
              <ul className="divide-y divide-border">
                {openTasks.map((t) => {
                  const isMine = myId != null && t.claimer_id === myId;
                  return (
                    <li key={t.id} className="py-3 space-y-1.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-ink">{t.title}</span>
                        <span
                          className={clsx(
                            'text-[10px] px-1.5 py-0.5 rounded-pix',
                            t.priority === 'high'
                              ? 'bg-red-50 text-red-500'
                              : t.priority === 'low'
                                ? 'bg-bg2 text-ink2'
                                : 'bg-accent-50 text-accent-700'
                          )}
                        >
                          {t.priority === 'high' ? '高' : t.priority === 'low' ? '低' : '中'}
                        </span>
                        <span className="text-[11px] text-ink2">
                          协调人 {t.coordinator_name ?? '—'}
                          {t.claimer_name ? ` · 认领 ${t.claimer_name}` : ' · 待认领'}
                        </span>
                        <span className="ml-auto flex items-center gap-1.5">
                          {!t.claimer_id && (
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => void onTaskAction(`claim-${t.id}`, () => taskClaim(team!, t.id), '已认领')}
                              loading={busy === `claim-${t.id}`}
                            >
                              认领
                            </Button>
                          )}
                          {isMine && (
                            <>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() =>
                                  void onTaskAction(`abandon-${t.id}`, () => taskAbandon(team!, t.id), '已放弃认领')
                                }
                                loading={busy === `abandon-${t.id}`}
                              >
                                放弃
                              </Button>
                              <Button
                                variant="primary"
                                size="sm"
                                icon={<Check size={12} />}
                                onClick={() => void onTaskAction(`done-${t.id}`, () => taskComplete(team!, t.id), '任务完成')}
                                loading={busy === `done-${t.id}`}
                              >
                                完成
                              </Button>
                            </>
                          )}
                        </span>
                      </div>
                      {t.description && (
                        <div className="text-xs text-ink2 line-clamp-2">{t.description}</div>
                      )}
                      {t.latest_ledger && (
                        <div className="text-[11px] text-ink2 flex flex-wrap gap-x-3">
                          <span>进度 {t.latest_ledger.progress}%</span>
                          {t.latest_ledger.latest && <span>最近：{t.latest_ledger.latest}</span>}
                          {t.latest_ledger.problems && <span>问题：{t.latest_ledger.problems}</span>}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>
      )}

      {/* 每日提报 */}
      {tab === 'submission' && (
        <div className="space-y-4 max-w-[760px]">
          <Card
            title={`我的今日提报（${today}）`}
            description="系统生成“该交什么”清单作参考，内容本人手写；24 小时内可修改（留版本）"
          >
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<Sparkles size={13} />}
                  onClick={() => void onGenChecklist()}
                  loading={busy === 'checklist'}
                >
                  生成"该交什么"清单
                </Button>
                {mySubmission && (
                  <span className="text-[11px] text-ink2">
                    今日已提交 · 已改 {mySubmission.edit_count} 次
                  </span>
                )}
              </div>
              {checklistHint && (
                <pre className="text-xs text-ink2 bg-bg-soft rounded-pix p-3 whitespace-pre-wrap font-sans">
                  {checklistHint}
                </pre>
              )}
              <textarea
                value={freeText}
                onChange={(e) => setFreeText(e.target.value)}
                placeholder={'今日做了什么 / 明日计划 / 需要的支持…\n（截图记录可在首页一键生成日报草稿作参考）'}
                className="input-base h-44 resize-y"
              />
              <div className="flex justify-end">
                <Button
                  variant="primary"
                  icon={<Send size={14} />}
                  onClick={() => void onSubmitReport()}
                  loading={busy === 'submit'}
                >
                  {mySubmission ? '更新提报' : '提交提报'}
                </Button>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* 团队日报 */}
      {tab === 'report' && (
        <div className="space-y-4 max-w-[760px]">
          <Card title={`团队日报（${today}）`} description="一键汇总全员提报，可推送到工作群">
            <div className="space-y-2">
              <Button
                variant="secondary"
                size="sm"
                icon={<FileText size={13} />}
                onClick={() => void onGenReport()}
                loading={busy === 'report'}
              >
                汇总今日团队日报
              </Button>
              <textarea
                value={reportText}
                onChange={(e) => setReportText(e.target.value)}
                className="input-base h-64 resize-y font-mono !text-xs"
                placeholder="点上方按钮汇总；也可以直接编辑"
              />
              <div className="flex items-center gap-2 flex-wrap">
                <select
                  value={pushChannel}
                  onChange={(e) => setPushChannel(e.target.value)}
                  className="input-base w-28"
                >
                  <option value="feishu">飞书</option>
                  <option value="dingtalk">钉钉</option>
                  <option value="wecom">企业微信</option>
                  <option value="telegram">Telegram</option>
                </select>
                <input
                  value={pushUrl}
                  onChange={(e) => setPushUrl(e.target.value)}
                  placeholder="群机器人 Webhook 地址"
                  className="input-base flex-1 min-w-[200px]"
                />
                <Button
                  variant="primary"
                  icon={<Send size={14} />}
                  onClick={() => void onPushReport()}
                  loading={busy === 'push'}
                >
                  推送
                </Button>
              </div>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
