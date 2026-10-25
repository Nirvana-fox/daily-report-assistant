import { useCallback, useEffect, useState } from 'react';
import { Check, Pencil, Plus, Trash2, X, FolderCheck } from 'lucide-react';
import Card from '../../components/Card';
import Button from '../../components/Button';
import {
  profileCompleteProject,
  profileDeleteProject,
  profileListProjects,
  profileSaveProject,
} from '../../api/ipc';
import type { ProjectDossier } from '../../api/types';
import { useToast } from '../../hooks/useToast';
import clsx from 'clsx';

const EMPTY = {
  name: '',
  status: 'active',
  start_date: '',
  end_date: '',
  role: '',
  goals: '',
  results: '',
  outputs: '',
  notes: '',
  commit_count: 0,
};

/** 项目档案：进行中 / 已完成；结项补全日期并结构化归档 */
export default function ProjectsTab() {
  const toast = useToast();
  const [projects, setProjects] = useState<ProjectDossier[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ ...EMPTY });
  const [editingId, setEditingId] = useState<number | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | number | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setProjects(await profileListProjects());
    } catch (e) {
      toast.error(`加载项目档案失败: ${e}`);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const openEdit = (p: ProjectDossier) => {
    setEditingId(p.id);
    setAdding(true);
    setForm({
      name: p.name,
      status: p.status,
      start_date: p.start_date ?? '',
      end_date: p.end_date ?? '',
      role: p.role,
      goals: p.goals,
      results: p.results,
      outputs: p.outputs,
      notes: p.notes,
      commit_count: p.commit_count,
    });
  };

  const resetForm = () => {
    setAdding(false);
    setEditingId(null);
    setForm({ ...EMPTY });
  };

  const onSave = async () => {
    if (!form.name.trim()) {
      toast.error('项目名不能为空');
      return;
    }
    setBusy('save');
    try {
      await profileSaveProject({
        name: form.name.trim(),
        status: form.status,
        start_date: form.start_date || null,
        end_date: form.end_date || null,
        role: form.role,
        goals: form.goals,
        results: form.results,
        outputs: form.outputs,
        notes: form.notes,
        commit_count: Number(form.commit_count) || 0,
      });
      toast.success(editingId ? '已更新项目档案' : '已添加项目档案');
      resetForm();
      await refresh();
    } catch (e) {
      toast.error(`保存失败: ${e}`);
    } finally {
      setBusy(null);
    }
  };

  const onComplete = async (p: ProjectDossier) => {
    setBusy(p.id);
    try {
      await profileCompleteProject(p.id);
      toast.success(`「${p.name}」已结项归档`);
      await refresh();
    } catch (e) {
      toast.error(`结项失败: ${e}`);
    } finally {
      setBusy(null);
    }
  };

  const onDelete = async (p: ProjectDossier) => {
    if (confirmDeleteId !== p.id) {
      setConfirmDeleteId(p.id);
      return;
    }
    setBusy(p.id);
    try {
      await profileDeleteProject(p.id);
      toast.info('已删除');
      setConfirmDeleteId(null);
      await refresh();
    } catch (e) {
      toast.error(`删除失败: ${e}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      <Card
        title="项目档案"
        description="完成的项目在此结构化沉淀：时间段 / 角色 / 产出 / 复盘，长期可被报告与 AI 引用"
      >
        <div className="flex items-center gap-2 mb-3">
          <Button
            variant="primary"
            size="sm"
            icon={adding ? <X size={13} /> : <Plus size={13} />}
            onClick={() => (adding ? resetForm() : setAdding(true))}
          >
            {adding ? '取消' : '新建项目档案'}
          </Button>
          <span className="text-[11px] text-ink2 ml-auto">
            进行中 {projects.filter((p) => p.status === 'active').length} · 已完成{' '}
            {projects.filter((p) => p.status !== 'active').length}
          </span>
        </div>

        {adding && (
          <div className="mb-4 p-3 rounded-pix border border-border bg-bg-soft space-y-2">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="项目名 *"
                className="input-base"
              />
              <select
                value={form.status}
                onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
                className="input-base"
              >
                <option value="active">进行中</option>
                <option value="completed">已完成</option>
              </select>
              <input
                type="date"
                value={form.start_date}
                onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value }))}
                className="input-base"
              />
              <input
                type="date"
                value={form.end_date}
                onChange={(e) => setForm((f) => ({ ...f, end_date: e.target.value }))}
                className="input-base"
                placeholder="结束日期"
              />
            </div>
            <input
              value={form.role}
              onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
              placeholder="我的角色，如：后端主力"
              className="input-base"
            />
            <textarea
              value={form.outputs}
              onChange={(e) => setForm((f) => ({ ...f, outputs: e.target.value }))}
              placeholder="关键产出，如：接入网关 v1 · 4 份周报"
              className="input-base h-14 resize-none"
            />
            <textarea
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              placeholder="复盘要点（可选）"
              className="input-base h-14 resize-none"
            />
            <div className="flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={resetForm}>
                取消
              </Button>
              <Button
                variant="primary"
                size="sm"
                icon={<Check size={13} />}
                onClick={() => void onSave()}
                loading={busy === 'save'}
              >
                保存
              </Button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="py-8 text-center text-sm text-ink2">加载中...</div>
        ) : projects.length === 0 ? (
          <div className="py-8 text-center text-sm text-ink2">
            还没有项目档案 —— 项目做完点「结项」，AI 会帮你把这段时间的记录汇总成档案
          </div>
        ) : (
          <div className="space-y-2">
            {projects.map((p) => (
              <div
                key={p.id}
                className={clsx(
                  'p-3 rounded-pix border transition-colors',
                  p.status === 'active'
                    ? 'border-border bg-card'
                    : 'border-border bg-bg-soft'
                )}
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-ink">{p.name}</span>
                  <span
                    className={clsx(
                      'text-[10px] px-1.5 py-0.5 rounded-pix',
                      p.status === 'active'
                        ? 'bg-primary-50 text-primary-700'
                        : 'bg-bg2 text-ink2'
                    )}
                  >
                    {p.status === 'active' ? '进行中' : '已完成'}
                  </span>
                  <span className="text-[11px] text-ink2">
                    {p.start_date ?? '?'} ~ {p.end_date ?? '至今'}
                  </span>
                  <span className="ml-auto flex items-center gap-0.5">
                    {p.status === 'active' && (
                      <Button
                        variant="secondary"
                        size="sm"
                        icon={<FolderCheck size={12} />}
                        onClick={() => void onComplete(p)}
                        loading={busy === p.id}
                      >
                        结项
                      </Button>
                    )}
                    <button
                      type="button"
                      title="编辑"
                      onClick={() => openEdit(p)}
                      className="p-1 rounded-pix text-ink2 hover:text-primary-700 hover:bg-primary-50"
                    >
                      <Pencil size={13} />
                    </button>
                    <button
                      type="button"
                      title={confirmDeleteId === p.id ? '再点一次确认删除' : '删除'}
                      onClick={() => void onDelete(p)}
                      className={clsx(
                        'p-1 rounded-pix transition-colors',
                        confirmDeleteId === p.id
                          ? 'text-red-500 bg-red-50'
                          : 'text-ink2 hover:text-red-500 hover:bg-red-50'
                      )}
                    >
                      <Trash2 size={13} />
                    </button>
                  </span>
                </div>
                <div className="mt-1 text-xs text-ink2 flex flex-wrap gap-x-4 gap-y-0.5">
                  {p.role && <span>角色：{p.role}</span>}
                  {p.outputs && <span>产出：{p.outputs}</span>}
                  {p.commit_count > 0 && <span>提交 {p.commit_count} 次</span>}
                </div>
                {p.notes && (
                  <div className="mt-1 text-xs text-ink2/90 line-clamp-2">复盘：{p.notes}</div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
