import { useCallback, useEffect, useState } from 'react';
import { Eye, EyeOff, Pencil, Plus, Trash2, Check, X, Info } from 'lucide-react';
import Card from '../../components/Card';
import Button from '../../components/Button';
import { Select } from '../../components/Input';
import {
  profileAddField,
  profileDeleteField,
  profileListFields,
  profileSetFieldHidden,
  profileUpdateField,
} from '../../api/ipc';
import type { ProfileField } from '../../api/types';
import { useToast } from '../../hooks/useToast';
import clsx from 'clsx';

const GROUPS = [
  { key: 'identity', label: '身份与角色' },
  { key: 'stack', label: '技术栈与工具' },
  { key: 'collaborators', label: '团队与协作' },
  { key: 'preference', label: '汇报与偏好' },
  { key: 'custom', label: '自定义' },
];

const groupLabel = (g: string) => GROUPS.find((x) => x.key === g)?.label ?? '自定义';

/** 我的档案：分组展示，支持手动添加 / 编辑 / 删除 / 隐藏；每条可展开"解释"（证据来源） */
export default function ProfileTab() {
  const toast = useToast();
  const [fields, setFields] = useState<ProfileField[]>([]);
  const [loading, setLoading] = useState(true);
  const [showHidden, setShowHidden] = useState(false);
  // 添加表单
  const [adding, setAdding] = useState(false);
  const [addGroup, setAddGroup] = useState('stack');
  const [addKey, setAddKey] = useState('');
  const [addValue, setAddValue] = useState('');
  // 行内编辑
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editValue, setEditValue] = useState('');
  // 两步删除确认
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  // 展开解释
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [busyId, setBusyId] = useState<number | 'add' | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setFields(await profileListFields(true));
    } catch (e) {
      toast.error(`加载档案失败: ${e}`);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const visible = fields.filter((f) => showHidden || !f.hidden);

  const onAdd = async () => {
    if (!addKey.trim() || !addValue.trim()) {
      toast.error('字段名和内容不能为空');
      return;
    }
    setBusyId('add');
    try {
      await profileAddField(addGroup, addKey.trim(), addValue.trim());
      toast.success('已添加档案字段');
      setAddKey('');
      setAddValue('');
      setAdding(false);
      await refresh();
    } catch (e) {
      toast.error(`添加失败: ${e}`);
    } finally {
      setBusyId(null);
    }
  };

  const onSaveEdit = async (id: number) => {
    setBusyId(id);
    try {
      await profileUpdateField(id, editValue.trim());
      toast.success('已更新');
      setEditingId(null);
      await refresh();
    } catch (e) {
      toast.error(`更新失败: ${e}`);
    } finally {
      setBusyId(null);
    }
  };

  const onToggleHidden = async (f: ProfileField) => {
    setBusyId(f.id);
    try {
      await profileSetFieldHidden(f.id, !f.hidden);
      await refresh();
    } catch (e) {
      toast.error(`操作失败: ${e}`);
    } finally {
      setBusyId(null);
    }
  };

  const onDelete = async (f: ProfileField) => {
    if (confirmDeleteId !== f.id) {
      setConfirmDeleteId(f.id);
      return;
    }
    setBusyId(f.id);
    try {
      await profileDeleteField(f.id);
      toast.info('已删除');
      setConfirmDeleteId(null);
      await refresh();
    } catch (e) {
      toast.error(`删除失败: ${e}`);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-4">
      <Card
        title="我的档案"
        description="AI 回答与报告生成时会优先采用这里确认过的事实；AI 的更新建议出现在「待确认」里，采纳后才写入"
      >
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <Button
            variant="primary"
            size="sm"
            icon={adding ? <X size={13} /> : <Plus size={13} />}
            onClick={() => setAdding((v) => !v)}
          >
            {adding ? '取消添加' : '手动添加'}
          </Button>
          <button
            type="button"
            onClick={() => setShowHidden((v) => !v)}
            className={clsx(
              'text-xs px-2.5 py-1 rounded-pix border transition-colors',
              showHidden
                ? 'border-primary-300 text-primary-700 bg-primary-50'
                : 'border-border text-ink2 hover:text-ink'
            )}
          >
            {showHidden ? '隐藏已隐藏项' : '显示已隐藏项'}
          </button>
          <span className="text-[11px] text-ink2 ml-auto">
            共 {fields.length} 条 · 隐藏 {fields.filter((f) => f.hidden).length} 条
          </span>
        </div>

        {adding && (
          <div className="mb-4 p-3 rounded-pix border border-border bg-bg-soft space-y-2">
            <div className="flex gap-2">
              <Select
                value={addGroup}
                onChange={(e) => setAddGroup(e.target.value)}
                className="w-40 text-sm"
              >
                {GROUPS.map((g) => (
                  <option key={g.key} value={g.key}>
                    {g.label}
                  </option>
                ))}
              </Select>
              <input
                value={addKey}
                onChange={(e) => setAddKey(e.target.value)}
                placeholder="字段名，如：技术栈 / 常协作"
                className="input-base flex-1"
              />
            </div>
            <textarea
              value={addValue}
              onChange={(e) => setAddValue(e.target.value)}
              placeholder="内容，如：Rust · Tauri · React · SQLite"
              className="input-base h-16 resize-none"
            />
            <div className="flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={() => setAdding(false)}>
                取消
              </Button>
              <Button
                variant="primary"
                size="sm"
                icon={<Check size={13} />}
                onClick={() => void onAdd()}
                loading={busyId === 'add'}
              >
                保存
              </Button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="py-8 text-center text-sm text-ink2">加载中...</div>
        ) : visible.length === 0 ? (
          <div className="py-8 text-center text-sm text-ink2">
            档案还是空的 —— 手动添加几条，或让 AI 在「做梦」后给你建议
          </div>
        ) : (
          <div className="space-y-4">
            {GROUPS.map((g) => {
              const items = visible.filter((f) => f.group_name === g.key);
              if (items.length === 0) return null;
              return (
                <div key={g.key}>
                  <h4 className="text-xs font-semibold text-ink2 mb-1.5">{g.label}</h4>
                  <div className="rounded-pix border border-border divide-y divide-border">
                    {items.map((f) => (
                      <div
                        key={f.id}
                        className={clsx('px-3 py-2', f.hidden && 'opacity-50')}
                      >
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-medium text-ink2 shrink-0 w-28 truncate">
                            {f.key}
                          </span>
                          {editingId === f.id ? (
                            <>
                              <input
                                value={editValue}
                                onChange={(e) => setEditValue(e.target.value)}
                                className="input-base flex-1 min-w-[200px] !py-1"
                                autoFocus
                              />
                              <button
                                type="button"
                                title="保存"
                                onClick={() => void onSaveEdit(f.id)}
                                className="p-1 rounded-pix text-primary-700 hover:bg-primary-50"
                              >
                                <Check size={14} />
                              </button>
                              <button
                                type="button"
                                title="取消"
                                onClick={() => setEditingId(null)}
                                className="p-1 rounded-pix text-ink2 hover:bg-bg"
                              >
                                <X size={14} />
                              </button>
                            </>
                          ) : (
                            <>
                              <span className="text-sm text-ink flex-1 min-w-0 break-all">
                                {f.value}
                              </span>
                              {f.confidence === 'pending' && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded-pix bg-accent-50 text-accent-700 shrink-0">
                                  待确认
                                </span>
                              )}
                              <span className="pf-acts flex items-center gap-0.5 shrink-0 opacity-50 hover:opacity-100 transition-opacity">
                                <button
                                  type="button"
                                  title="编辑"
                                  onClick={() => {
                                    setEditingId(f.id);
                                    setEditValue(f.value);
                                  }}
                                  className="p-1 rounded-pix text-ink2 hover:text-primary-700 hover:bg-primary-50"
                                >
                                  <Pencil size={13} />
                                </button>
                                <button
                                  type="button"
                                  title={f.hidden ? '恢复（重新参与 AI 上下文）' : '隐藏（暂不参与 AI 上下文）'}
                                  onClick={() => void onToggleHidden(f)}
                                  className="p-1 rounded-pix text-ink2 hover:text-primary-700 hover:bg-primary-50"
                                >
                                  {f.hidden ? <EyeOff size={13} className="opacity-60" /> : <Eye size={13} />}
                                </button>
                                <button
                                  type="button"
                                  title={confirmDeleteId === f.id ? '再点一次确认删除' : '删除'}
                                  onClick={() => void onDelete(f)}
                                  className={clsx(
                                    'p-1 rounded-pix transition-colors',
                                    confirmDeleteId === f.id
                                      ? 'text-red-500 bg-red-50'
                                      : 'text-ink2 hover:text-red-500 hover:bg-red-50'
                                  )}
                                >
                                  <Trash2 size={13} />
                                </button>
                                <button
                                  type="button"
                                  title="解释（证据来源）"
                                  onClick={() => setExpandedId(expandedId === f.id ? null : f.id)}
                                  className="p-1 rounded-pix text-ink2 hover:text-primary-700 hover:bg-primary-50"
                                >
                                  <Info size={13} />
                                </button>
                              </span>
                            </>
                          )}
                        </div>
                        {expandedId === f.id && (
                          <div className="mt-1.5 ml-[7.2rem] text-[11px] text-ink2 space-y-0.5">
                            <div>
                              来源：
                              {f.source_refs?.length
                                ? f.source_refs
                                    .map((r) =>
                                      r.type === 'manual' ? '手动维护' : `${r.type}#${r.id ?? '?'}`
                                    )
                                    .join('、')
                                : '无（早期数据）'}
                            </div>
                            <div>更新时间：{f.updated_at}</div>
                            {f.valid_to && <div>有效期至：{f.valid_to}</div>}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
