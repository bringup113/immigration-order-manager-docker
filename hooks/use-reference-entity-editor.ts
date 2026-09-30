"use client";

import { useMemo, useState } from "react";
import { apiPost, useApiList } from "@/lib/use-api";

type ReferenceRow = {
  id: string;
  name: string;
  active: number | boolean;
};

type ReferenceForm = {
  name: string;
};

export function useReferenceEntityEditor<
  Row extends ReferenceRow,
  Form extends ReferenceForm,
>({
  resource,
  blank,
  toForm,
  searchText,
}: {
  resource: string;
  blank: Form;
  toForm: (row: Row) => Form;
  searchText: (row: Row) => string;
}) {
  const list = useApiList<Row>(resource);
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState("");
  const [form, setForm] = useState<Form>(blank);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");
  const [toggleTarget, setToggleTarget] = useState<Row | null>(null);

  const visible = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return list.rows;
    return list.rows.filter((row) =>
      searchText(row).toLowerCase().includes(normalizedQuery),
    );
  }, [list.rows, query, searchText]);

  function openCreate() {
    setEditingId("");
    setForm(blank);
    setMessage("");
    setOpen(true);
  }

  function openEdit(row: Row) {
    setEditingId(row.id);
    setForm(toForm(row));
    setMessage("");
    setOpen(true);
  }

  async function save() {
    setSaving(true);
    setMessage("");
    try {
      await apiPost(resource, {
        ...form,
        action: editingId ? "update" : "create",
        id: editingId || undefined,
      });
      setOpen(false);
      setForm(blank);
      setEditingId("");
      await list.reload();
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function toggle(row: Row) {
    if (Boolean(row.active)) {
      setMessage("");
      setToggleTarget(row);
      return;
    }
    try {
      await apiPost(resource, {
        action: "activate",
        id: row.id,
        name: row.name,
      });
      await list.reload();
    } catch (reason) {
      setMessage(
        reason instanceof Error ? reason.message : "状态修改失败",
      );
    }
  }

  async function confirmDeactivate() {
    if (!toggleTarget) return;
    setSaving(true);
    try {
      await apiPost(resource, {
        action: "deactivate",
        id: toggleTarget.id,
        name: toggleTarget.name,
      });
      setToggleTarget(null);
      await list.reload();
    } catch (reason) {
      setMessage(
        reason instanceof Error ? reason.message : "状态修改失败",
      );
    } finally {
      setSaving(false);
    }
  }

  return {
    ...list,
    visible,
    open,
    setOpen,
    editingId,
    form,
    setForm,
    saving,
    message,
    query,
    setQuery,
    toggleTarget,
    setToggleTarget,
    openCreate,
    openEdit,
    save,
    toggle,
    confirmDeactivate,
  };
}
