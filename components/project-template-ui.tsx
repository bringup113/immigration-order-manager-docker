"use client";

import type { ReactNode } from "react";
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export function TemplatePanel({
  title,
  note,
  onAdd,
  addLabel = "新增",
  extraAction,
  editable,
  children,
}: {
  title: string;
  note: string;
  onAdd: () => void;
  addLabel?: string;
  extraAction?: ReactNode;
  editable: boolean;
  children: ReactNode;
}) {
  return (
    <section className="panel p-6">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="font-semibold">{title}</h2>
          <p className="mt-1 text-sm text-slate-500">{note}</p>
        </div>
        {editable && (
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button variant="outline" onClick={onAdd}>
              <Plus size={16} /> {addLabel}
            </Button>
            {extraAction}
          </div>
        )}
      </div>
      {children}
    </section>
  );
}

export function TemplateRow({
  index,
  title,
  meta,
  onMoveUp,
  onMoveDown,
  onEdit,
  onRemove,
}: {
  index: number;
  title: string;
  meta: string;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onEdit?: () => void;
  onRemove?: () => void;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border p-4">
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-slate-100 text-xs">
        {index}
      </span>
      <div className="min-w-0 flex-1">
        <b className="text-sm">{title}</b>
        <p className="mt-1 text-xs text-slate-500">{meta}</p>
      </div>
      {(onMoveUp || onMoveDown) && (
        <div className="flex">
          <Button
            variant="ghost"
            size="icon"
            disabled={!onMoveUp}
            onClick={onMoveUp}
            title="上移"
            aria-label={`上移：${title}`}
          >
            <ArrowUp size={15} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            disabled={!onMoveDown}
            onClick={onMoveDown}
            title="下移"
            aria-label={`下移：${title}`}
          >
            <ArrowDown size={15} />
          </Button>
        </div>
      )}
      {onEdit && (
        <Button variant="outline" size="sm" onClick={onEdit}>
          <Pencil size={15} /> 修改
        </Button>
      )}
      {onRemove && (
        <Button
          variant="ghost"
          size="icon"
          onClick={onRemove}
          title="删除"
          aria-label={`删除：${title}`}
        >
          <Trash2 size={16} />
        </Button>
      )}
    </div>
  );
}
