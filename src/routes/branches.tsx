import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Building2, Plus, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { DashboardShell } from "@/components/DashboardShell";
import { EmptyState } from "@/components/EmptyState";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useLang } from "@/i18n/LanguageProvider";
import {
  getBranches, createBranch, updateBranch, deleteBranch,
  getCurrentUser, subscribeBranches, listBranchObjects,
  type AuthUser,
} from "@/services/api";
import type { DxBranch } from "@/services/directus";

export const Route = createFileRoute("/branches")({
  component: BranchesPage,
});

type FormState = {
  name: string;
  code: string;
  address: string;
  phone: string;
  is_active: boolean;
};

const EMPTY: FormState = { name: "", code: "", address: "", phone: "", is_active: true };

function BranchesPage() {
  const { dir } = useLang();
  const navigate = useNavigate();
  const [user, setUser] = useState<AuthUser | null>(() => getCurrentUser());
  const [items, setItems] = useState<DxBranch[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<DxBranch | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [toDelete, setToDelete] = useState<DxBranch | null>(null);

  useEffect(() => {
    const u = getCurrentUser();
    if (!u || u.role !== "admin") {
      navigate({ to: "/login" });
      return;
    }
    setUser(u);
    const refresh = () => {
      getBranches()
        .then((rows) => { setItems(rows); setLoading(false); })
        .catch(() => setLoading(false));
    };
    refresh();
    setItems(listBranchObjects());
    const off = subscribeBranches(() => setItems(listBranchObjects()));
    return () => off();
  }, [navigate]);

  const openAdd = () => { setForm(EMPTY); setAdding(true); setEditing(null); };
  const openEdit = (b: DxBranch) => {
    setForm({
      name: b.name,
      code: b.code,
      address: b.address ?? "",
      phone: b.phone ?? "",
      is_active: b.is_active ?? true,
    });
    setEditing(b);
    setAdding(false);
  };
  const closeForm = () => { setAdding(false); setEditing(null); setForm(EMPTY); };

  const onSave = async () => {
    if (!form.name.trim() || !form.code.trim()) {
      toast.error(dir === "rtl" ? "الاسم والكود مطلوبان" : "Name and code are required");
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        await updateBranch(editing.id, form);
        toast.success(dir === "rtl" ? "تم الحفظ" : "Saved");
      } else {
        await createBranch(form);
        toast.success(dir === "rtl" ? "تم إنشاء الفرع" : "Branch created");
      }
      closeForm();
    } catch (e: any) {
      toast.error(e?.message ?? (dir === "rtl" ? "فشل الحفظ" : "Save failed"));
    } finally {
      setSaving(false);
    }
  };

  const onDelete = async () => {
    if (!toDelete) return;
    try {
      await deleteBranch(toDelete.id);
      toast.success(dir === "rtl" ? "تم حذف الفرع" : "Branch deleted");
      setToDelete(null);
    } catch (e: any) {
      toast.error(e?.message ?? (dir === "rtl" ? "فشل الحذف" : "Delete failed"));
    }
  };

  if (!user) return null;
  const title = dir === "rtl" ? "الفروع" : "Branches";

  return (
    <DashboardShell role="admin" title={title}>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {dir === "rtl" ? "إدارة فروع الشركة وحالة تفعيلها" : "Manage company branches and their status"}
        </p>
        <button
          onClick={openAdd}
          className="inline-flex h-10 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" />
          {dir === "rtl" ? "إضافة فرع" : "Add branch"}
        </button>
      </div>

      {loading ? (
        <div className="rounded-2xl border border-border bg-card p-8 text-center text-sm text-muted-foreground shadow-card">
          {dir === "rtl" ? "جارٍ التحميل..." : "Loading..."}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={<Building2 className="h-7 w-7" />}
          title={dir === "rtl" ? "لا توجد فروع بعد" : "No branches yet"}
        />
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-card">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr className={dir === "rtl" ? "text-right" : "text-left"}>
                <th className="px-4 py-3 font-semibold">{dir === "rtl" ? "الاسم" : "Name"}</th>
                <th className="px-4 py-3 font-semibold">{dir === "rtl" ? "الكود" : "Code"}</th>
                <th className="px-4 py-3 font-semibold">{dir === "rtl" ? "العنوان" : "Address"}</th>
                <th className="px-4 py-3 font-semibold">{dir === "rtl" ? "الهاتف" : "Phone"}</th>
                <th className="px-4 py-3 font-semibold">{dir === "rtl" ? "الحالة" : "Status"}</th>
                <th className="px-4 py-3 font-semibold">{dir === "rtl" ? "إجراءات" : "Actions"}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((b) => (
                <tr key={b.id} className="border-t border-border hover:bg-muted/30">
                  <td className="px-4 py-3 font-semibold text-foreground">{b.name}</td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{b.code}</td>
                  <td className="px-4 py-3 text-muted-foreground">{b.address || "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">{b.phone || "—"}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${
                      b.is_active
                        ? "bg-success/10 text-success ring-success/20"
                        : "bg-muted text-muted-foreground ring-border"
                    }`}>
                      {b.is_active
                        ? (dir === "rtl" ? "نشط" : "Active")
                        : (dir === "rtl" ? "غير نشط" : "Inactive")}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => openEdit(b)}
                        className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 text-xs font-semibold text-foreground hover:bg-muted"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        {dir === "rtl" ? "تعديل" : "Edit"}
                      </button>
                      <button
                        onClick={() => setToDelete(b)}
                        className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-destructive/30 px-2.5 text-xs font-semibold text-destructive hover:bg-destructive/10"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        {dir === "rtl" ? "حذف" : "Delete"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(adding || editing) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 p-4" onClick={closeForm}>
          <div
            className="w-full max-w-md rounded-2xl bg-card p-5 shadow-elegant"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="mb-4 text-lg font-bold text-foreground">
              {editing
                ? (dir === "rtl" ? "تعديل فرع" : "Edit branch")
                : (dir === "rtl" ? "فرع جديد" : "New branch")}
            </h2>
            <div className="space-y-3">
              <Field label={dir === "rtl" ? "الاسم" : "Name"} value={form.name} onChange={(v) => setForm((f) => ({ ...f, name: v }))} />
              <Field label={dir === "rtl" ? "الكود (مثل DXB-01)" : "Code (e.g. DXB-01)"} value={form.code} onChange={(v) => setForm((f) => ({ ...f, code: v.toUpperCase() }))} />
              <Field label={dir === "rtl" ? "العنوان" : "Address"} value={form.address} onChange={(v) => setForm((f) => ({ ...f, address: v }))} />
              <Field label={dir === "rtl" ? "الهاتف" : "Phone"} value={form.phone} onChange={(v) => setForm((f) => ({ ...f, phone: v }))} />
              <label className="flex items-center gap-2 text-sm text-foreground">
                <input
                  type="checkbox"
                  checked={form.is_active}
                  onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))}
                  className="h-4 w-4 rounded border-input"
                />
                {dir === "rtl" ? "نشط" : "Active"}
              </label>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={closeForm}
                className="inline-flex h-10 items-center rounded-xl border border-border bg-surface px-4 text-sm font-semibold text-foreground hover:bg-muted"
              >
                {dir === "rtl" ? "إلغاء" : "Cancel"}
              </button>
              <button
                onClick={onSave}
                disabled={saving}
                className="inline-flex h-10 items-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {saving
                  ? (dir === "rtl" ? "جارٍ الحفظ..." : "Saving...")
                  : (dir === "rtl" ? "حفظ" : "Save")}
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!toDelete}
        destructive
        title={dir === "rtl" ? "حذف الفرع" : "Delete branch"}
        body={
          toDelete
            ? (dir === "rtl"
                ? `سيتم حذف "${toDelete.name}" نهائياً.`
                : `"${toDelete.name}" will be permanently deleted.`)
            : ""
        }
        confirmLabel={dir === "rtl" ? "حذف" : "Delete"}
        cancelLabel={dir === "rtl" ? "إلغاء" : "Cancel"}
        onConfirm={onDelete}
        onClose={() => setToDelete(null)}
      />
    </DashboardShell>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-semibold text-muted-foreground">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-10 w-full rounded-xl border border-input bg-surface px-3 text-sm text-foreground"
      />
    </div>
  );
}
