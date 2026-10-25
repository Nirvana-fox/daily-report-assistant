import { useCallback, useEffect, useState } from 'react';
import { Check, Moon, Pencil, X } from 'lucide-react';
import dayjs from 'dayjs';
import Card from '../../components/Card';
import Button from '../../components/Button';
import {
  profileDecideSuggestion,
  profileDreamLog,
  profileDreamNow,
  profileListSuggestions,
} from '../../api/ipc';
import type { DreamLogRow, ProfileSuggestion } from '../../api/types';
import { useToast } from '../../hooks/useToast';
import clsx from 'clsx';

const GROUP_LABELS: Record<string, string> = {
  identity: '身份与角色',
  stack: '技术栈与工具',
  collaborators: '团队与协作',
  preference: '汇报与偏好',
  custom: '自定义',
};

const KIND_BADGES: Record<string, { label: string; cls: string }> = {
  add: { label: '新增', cls: 'bg-primary-50 text-primary-700' },
  update: { label: '修改', cls: 'bg-accent-50 text-accent-700' },
  expire: { label: '过期', cls: 'bg-red-50 text-red-500' },
  project_note: { label: '小结', cls: 'bg-bg2 text-ink2' },
};

/** 待确认：AI（做梦/周度回顾）的档案建议队列 —— 改后采纳 / 采纳 / 忽略，永不静默写入 */
export default function SuggestionsTab() {
  const toast = useToast();
  const [pending, setPending] = useState<ProfileSuggestion[]>([]);
  const [history, setHistory] = useState<ProfileSuggestion[]>([]);
  const [dreamLog, setDreamLog] = useState<DreamLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [dreaming, setDreaming] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editText, setEditText] = useState('');
  const [busyId, setBusyId] = useState<number | 'dream' | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [p, h, log] = await Promise.all([
        profileListSuggestions('pending'),
        profileListSuggestions('accepted'),
        profileDreamLog(5),
      ]);
      setPending(p);
      setHistory(h.slice(0, 8));
      setDreamLog(log);
    } catch (e) {
      toast.error(`加载建议失败: ${e}`);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onDream = async () => {
    setDreaming(true);
    try {
      const st = await profileDreamNow();
      toast.success(`做梦完成：${st.detail}`);
      await refresh();
    } catch (e) {
      toast.error(`做梦失败: ${e}`);
    } finally {
      setDreaming(false);
    }
  };

  const onDecide = async (s: ProfileSuggestion, accept: boolean, edited?: string) => {
    setBusyId(s.id);
    try {
      await profileDecideSuggestion(s.id, accept, edited);
      toast.success(accept ? '已采纳并写入档案' : '已忽略');
      setEditingId(null);
      await refresh();
    } catch (e) {
      toast.error(`操作失败: ${e}`);
    } finally {
      setBusyId(null);
    }
  };

  const lastDream = dreamLog[0];

  return (
    <div className="space-y-4">
      {/* 做梦沉淀 */}
      <Card
        title="做梦沉淀"
        description="夜间空闲时 AI 复盘近 7 天记录，产出建议；也可手动触发"
      >
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2 text-xs text-ink2">
            <Moon size={14} className="text-primary-700" />
            {lastDream ? (
              <span>
                上次做梦 {dayjs(lastDream.ran_at).format('MM-DD HH:mm')} · 合并 {lastDream.merged} ·
                小结 {lastDream.summarized} · 过期 {lastDream.archived}
              </span>
            ) : (
              <span>还没有做过梦 —— 立即体验一次，AI 会复盘近 7 天的记录</span>
            )}
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Button
              variant="primary"
              size="sm"
              icon={<Moon size={13} />}
              onClick={() => void onDream()}
              loading={dreaming || busyId === 'dream'}
            >
              立即做梦
            </Button>
          </div>
        </div>
        {dreamLog.length > 1 && (
          <div className="mt-2 pt-2 border-t border-dashed border-border space-y-0.5">
            {dreamLog.slice(1).map((d) => (
              <div key={d.id} className="text-[11px] text-ink2/80">
                {dayjs(d.ran_at).format('MM-DD HH:mm')} · {d.detail}
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* 待确认队列 */}
      <Card title="待确认" description="每条都带 AI 的依据说明，可修改内容后再采纳">
        {loading ? (
          <div className="py-8 text-center text-sm text-ink2">加载中...</div>
        ) : pending.length === 0 ? (
          <div className="py-8 text-center text-sm text-ink2">
            没有待处理建议 —— 档案是最新状态
          </div>
        ) : (
          <div className="space-y-2">
            {pending.map((s) => {
              const badge = KIND_BADGES[s.kind] ?? KIND_BADGES.add;
              return (
                <div key={s.id} className="p-3 rounded-pix border border-border">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className={clsx(
                        'text-[10px] font-bold px-1.5 py-0.5 rounded-pix shrink-0',
                        badge.cls
                      )}
                    >
                      {badge.label}
                    </span>
                    <span className="text-xs text-ink2 shrink-0">
                      {GROUP_LABELS[s.group_name] ?? '自定义'} · {s.key}
                    </span>
                    <span className="text-[10px] text-ink2/70 ml-auto shrink-0">
                      {dayjs(s.created_at).format('MM-DD HH:mm')}
                    </span>
                  </div>
                  {s.kind === 'update' && s.old_value && (
                    <div className="mt-1.5 text-xs text-ink2/80 line-through">
                      原值：{s.old_value}
                    </div>
                  )}
                  {editingId === s.id ? (
                    <div className="mt-1.5">
                      <textarea
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        className="input-base h-16 resize-none"
                        autoFocus
                      />
                      <div className="flex justify-end gap-2 mt-1.5">
                        <Button variant="secondary" size="sm" onClick={() => setEditingId(null)}>
                          取消
                        </Button>
                        <Button
                          variant="primary"
                          size="sm"
                          icon={<Check size={13} />}
                          onClick={() => void onDecide(s, true, editText.trim())}
                          loading={busyId === s.id}
                        >
                          按修改采纳
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-1 text-sm text-ink">{s.new_value}</div>
                  )}
                  {s.rationale && (
                    <div className="mt-1 text-[11px] text-ink2/90">
                      依据：{s.rationale}
                    </div>
                  )}
                  {editingId !== s.id && (
                    <div className="mt-2 flex justify-end gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        icon={<Pencil size={12} />}
                        onClick={() => {
                          setEditingId(s.id);
                          setEditText(s.new_value);
                        }}
                      >
                        改后采纳
                      </Button>
                      <Button
                        variant="primary"
                        size="sm"
                        icon={<Check size={12} />}
                        onClick={() => void onDecide(s, true)}
                        loading={busyId === s.id}
                      >
                        采纳
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={<X size={12} />}
                        onClick={() => void onDecide(s, false)}
                        loading={busyId === s.id}
                      >
                        忽略
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* 最近已处理 */}
      {history.length > 0 && (
        <Card title="最近已采纳" description="进入档案的 AI 建议（可在「我的档案」里继续编辑）">
          <div className="space-y-1">
            {history.map((s) => (
              <div key={s.id} className="flex items-center gap-2 text-xs">
                <span className="text-ink2 shrink-0">
                  {GROUP_LABELS[s.group_name] ?? '自定义'} · {s.key}
                </span>
                <span className="text-ink truncate flex-1">{s.new_value}</span>
                <span className="text-[10px] text-ink2/70 shrink-0">
                  {dayjs(s.created_at).format('MM-DD')}
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
