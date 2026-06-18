import { useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { Download, Loader2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { useLang } from "@/i18n/LanguageProvider";
import { bulkImportUsers, listBranches, type BulkImportRow } from "@/services/api";

type ParsedRow = BulkImportRow & { _row: number; _ok: boolean; _reason?: string };

function safeLower(value: unknown): string {
  return (value ?? "").toString().toLowerCase();
}

export function ImportUsersDialog({
  open, onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { t, dir } = useLang();
  const branches = useMemo(() => listBranches(), [open]);
  const [branch, setBranch] = useState<string>("");
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [fileName, setFileName] = useState<string>("");
  const [loading, setLoading] = useState(false);

  if (!open) return null;

  const reset = () => { setRows([]); setFileName(""); };

  const downloadTemplate = () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ["Name", "Email", "Role", "Password"],
      ["Omar Example", "omar@example.com", "underwriter", "demo123"],
      ["Sara Example", "sara@example.com", "sales", ""],
      ["Khalid Sup", "khalid@example.com", "supervisor", ""],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Users");
    XLSX.writeFile(wb, "users-template.xlsx");
  };

  const onFile = async (file: File) => {
    setFileName(file.name);
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
    const parsed: ParsedRow[] = json.map((r, i) => {
      const get = (k: string) =>
        String(r[k] ?? r[safeLower(k)] ?? r[k.toUpperCase()] ?? "").trim();
      const name = get("Name");
      const email = safeLower(get("Email"));
      const roleRaw = safeLower(get("Role"));
      const password = get("Password");
      let ok = true;
      let reason: string | undefined;
      if (!name || !email || !roleRaw) { ok = false; reason = "missing fields"; }
      else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { ok = false; reason = "invalid email"; }
      else if (!["supervisor", "underwriter", "sales"].includes(roleRaw)) { ok = false; reason = "invalid role"; }
      return {
        _row: i + 2,
        _ok: ok,
        _reason: reason,
        name, email,
        role: (roleRaw as BulkImportRow["role"]),
        password: password || undefined,
      };
    });
    setRows(parsed);
  };

  const validRows = rows.filter((r) => r._ok);

  const submit = async () => {
    if (!branch) { toast.error(t.agents.importErrorBranchRequired); return; }
    if (validRows.length === 0) { toast.error(t.agents.importErrorNoRows); return; }
    setLoading(true);
    try {
      const result = await bulkImportUsers(branch, validRows.map(({ _row, _ok, _reason, ...r }) => r));
      toast.success(t.agents.importDone(result.created));
      if (result.skipped.length > 0) toast.message(t.agents.importSkipped(result.skipped.length));
      reset();
      onClose();
    } catch (e: any) {
      toast.error(e?.message ?? "Import failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-foreground/40 p-0 sm:items-center sm:p-4" dir={dir}>
      <div className="w-full max-w-2xl overflow-hidden rounded-t-2xl bg-card shadow-elevated sm:rounded-2xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-base font-bold text-foreground">{t.agents.importTitle}</h2>
          <button onClick={() => { reset(); onClose(); }} className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 p-5">
          <p className="text-xs text-muted-foreground">{t.agents.importHint}</p>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold text-muted-foreground">{t.agents.importPickBranch}</span>
              <select
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
                className="h-11 w-full rounded-xl border border-input bg-surface px-3 text-sm text-foreground"
              >
                <option value="">—</option>
                {branches.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            </label>
            <button
              onClick={downloadTemplate}
              type="button"
              className="mt-6 inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-border bg-surface px-4 text-sm font-semibold text-foreground hover:bg-muted"
            >
              <Download className="h-4 w-4" /> {t.agents.importDownloadTemplate}
            </button>
          </div>

          <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border bg-surface px-4 py-6 text-sm font-semibold text-foreground hover:bg-muted">
            <Upload className="h-4 w-4" />
            {fileName || t.agents.importPickFile}
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }}
            />
          </label>

          {rows.length > 0 && (
            <div className="overflow-hidden rounded-xl border border-border">
              <div className="bg-muted/50 px-3 py-2 text-xs font-semibold text-muted-foreground">
                {t.agents.importPreview} ({validRows.length}/{rows.length})
              </div>
              <div className="max-h-64 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="bg-muted/30 text-muted-foreground">
                    <tr>
                      <th className="px-2 py-1.5 text-start">#</th>
                      <th className="px-2 py-1.5 text-start">Name</th>
                      <th className="px-2 py-1.5 text-start">Email</th>
                      <th className="px-2 py-1.5 text-start">Role</th>
                      <th className="px-2 py-1.5 text-start">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r._row} className={`border-t border-border ${r._ok ? "" : "bg-destructive/5"}`}>
                        <td className="px-2 py-1.5 text-muted-foreground">{r._row}</td>
                        <td className="px-2 py-1.5 text-foreground">{r.name || "—"}</td>
                        <td className="px-2 py-1.5 text-muted-foreground">{r.email || "—"}</td>
                        <td className="px-2 py-1.5 text-muted-foreground">{r.role || "—"}</td>
                        <td className="px-2 py-1.5">
                          {r._ok ? (
                            <span className="inline-flex items-center rounded-full bg-success/15 px-2 py-0.5 font-semibold text-success">OK</span>
                          ) : (
                            <span className="inline-flex items-center rounded-full bg-destructive/15 px-2 py-0.5 font-semibold text-destructive">{r._reason}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => { reset(); onClose(); }}
              className="h-11 rounded-xl border border-border bg-surface px-4 text-sm font-semibold text-foreground"
            >
              {t.agents.cancel}
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={loading || validRows.length === 0 || !branch}
              className="inline-flex h-11 items-center gap-2 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground shadow-soft disabled:opacity-50"
            >
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              {t.agents.importStart}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
