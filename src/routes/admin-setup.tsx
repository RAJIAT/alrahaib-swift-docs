/**
 * Admin maintenance page — Owner/Admin only.
 *
 * Runs all the one-shot Directus housekeeping that previously required
 * shell access:
 *   - Add missing Agent permissions (audit_log create, request_missing_attachments r/c)
 *   - Tighten Public read permission on requests (no-list, by-id only)
 *   - Drop legacy collections (agents, requests_files)
 *
 * All calls go through the existing /api/directus proxy with the currently
 * logged-in user's bearer token, so the operator must be an Administrator.
 */
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { dxFetch } from "@/services/directus";
import { getCurrentUser } from "@/services/api";
import { Loader2, CheckCircle2, AlertCircle, Trash2, Shield, RefreshCw } from "lucide-react";

type LogLine = { ok: boolean; msg: string; detail?: any };

async function dxJson<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const r = await dxFetch(path, init);
  const text = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${path}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : ({} as T);
}

async function loadStatus() {
  const [collections, roles, me, policies] = await Promise.all([
    dxJson<{ data: any[] }>("/collections?limit=-1"),
    dxJson<{ data: any[] }>("/roles?fields=id,name"),
    dxJson<{ data: any }>("/users/me?fields=email,role.name"),
    dxJson<{ data: any[] }>("/policies?fields=id,name,roles"),
  ]);
  const colNames = collections.data.map((c: any) => c.collection);
  return {
    me: me.data,
    roles: roles.data,
    policies: policies.data,
    collections: colNames,
    hasLegacyAgents: colNames.includes("agents"),
    hasLegacyRequestsFiles: colNames.includes("requests_files"),
  };
}

function findPolicyForRole(policies: any[], roleId: string | null) {
  if (roleId === null) {
    return policies.find((p) => p.name?.toLowerCase().includes("public")) ?? null;
  }
  return (
    policies.find(
      (p) =>
        Array.isArray(p.roles) &&
        p.roles.some((r: any) => (typeof r === "string" ? r === roleId : r?.role === roleId)),
    ) ?? null
  );
}

async function ensurePerm(policyId: string, collection: string, action: string, fields = "*") {
  const existing = await dxJson<{ data: any[] }>(
    `/permissions?filter[policy][_eq]=${policyId}&filter[collection][_eq]=${collection}&filter[action][_eq]=${action}&limit=1`,
  );
  if (existing.data?.length) {
    return { skipped: true, collection, action };
  }
  await dxJson("/permissions", {
    method: "POST",
    body: JSON.stringify({
      policy: policyId,
      collection,
      action,
      fields,
      permissions: {},
      validation: {},
      presets: null,
    }),
  });
  return { created: true, collection, action };
}

export const Route = createFileRoute("/admin-setup")({
  beforeLoad: () => {
    if (typeof window !== "undefined" && !getCurrentUser()) throw redirect({ to: "/login" });
  },
  component: AdminSetupPage,
});

function AdminSetupPage() {
  const [user, setUser] = useState<any>(null);
  const [status, setStatus] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<LogLine[]>([]);

  const refresh = async () => {
    setLoading(true);
    try {
      const me = await getCurrentUser();
      setUser(me);
      setStatus(await loadStatus());
    } catch (e: any) {
      setLog((l) => [...l, { ok: false, msg: e.message }]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const isAdmin = user?.role === "admin" || status?.me?.role?.name === "Administrator";

  const append = (line: LogLine) => setLog((l) => [...l, line]);

  const runFixPermissions = async () => {
    if (!status) return;
    setRunning(true);
    try {
      const agentRole = status.roles.find((r: any) => r.name === "Agent");
      if (!agentRole) {
        append({ ok: false, msg: "دور Agent غير موجود" });
      } else {
        const policy = findPolicyForRole(status.policies, agentRole.id);
        if (!policy) {
          append({ ok: false, msg: "لا توجد policy لدور Agent" });
        } else {
          for (const [col, act] of [
            ["audit_log", "create"],
            ["request_missing_attachments", "read"],
            ["request_missing_attachments", "create"],
          ] as const) {
            try {
              const r = await ensurePerm(policy.id, col, act);
              append({ ok: true, msg: `Agent → ${col}.${act}`, detail: r });
            } catch (e: any) {
              append({ ok: false, msg: `Agent ${col}.${act} فشل`, detail: e.message });
            }
          }
        }
      }

      // Tighten public on requests
      const publicPolicy = findPolicyForRole(status.policies, null);
      if (publicPolicy) {
        const existing = await dxJson<{ data: any[] }>(
          `/permissions?filter[policy][_eq]=${publicPolicy.id}&filter[collection][_eq]=requests&filter[action][_eq]=read`,
        );
        for (const p of existing.data) {
          await dxJson(`/permissions/${p.id}`, {
            method: "PATCH",
            body: JSON.stringify({
              fields: ["id", "status", "reference_number", "created_at", "updated_at"],
              permissions: {},
            }),
          });
          append({ ok: true, msg: `تم تشديد صلاحيات Public على requests (id: ${p.id})` });
        }
        if (!existing.data.length) {
          append({ ok: true, msg: "Public لا يملك أي صلاحية read على requests (آمن)" });
        }
      }
    } finally {
      setRunning(false);
      await refresh();
    }
  };

  const runCleanup = async () => {
    if (!status) return;
    if (!confirm("سيتم حذف الجداول القديمة agents و requests_files نهائياً. متابعة؟")) return;
    setRunning(true);
    try {
      for (const col of ["agents", "requests_files"]) {
        if (!status.collections.includes(col)) {
          append({ ok: true, msg: `${col} غير موجود — تخطي` });
          continue;
        }
        try {
          const r = await dxFetch(`/collections/${col}`, { method: "DELETE" });
          if (r.ok) append({ ok: true, msg: `تم حذف ${col}` });
          else {
            const t = await r.text();
            append({ ok: false, msg: `فشل حذف ${col}`, detail: t.slice(0, 200) });
          }
        } catch (e: any) {
          append({ ok: false, msg: `خطأ في حذف ${col}`, detail: e.message });
        }
      }
    } finally {
      setRunning(false);
      await refresh();
    }
  };

  const runAll = async () => {
    await runFixPermissions();
    await runCleanup();
    append({ ok: true, msg: "اكتمل كل شيء ✓" });
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-xl p-8">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-destructive" />
              غير مصرح
            </CardTitle>
            <CardDescription>هذه الصفحة للمسؤولين فقط (Administrator).</CardDescription>
          </CardHeader>
          <CardContent>
            <Link to="/admin" className="text-primary underline">
              العودة للوحة التحكم
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">إعدادات النظام (مرة واحدة)</h1>
          <p className="text-sm text-muted-foreground">
            تنفيذ الإصلاحات المتبقية على Directus. آمن للتشغيل المتكرر — يتخطى ما تم تنفيذه.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={refresh} disabled={running}>
          <RefreshCw className="ml-2 h-4 w-4" /> تحديث
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>الحالة الحالية</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div>
            متصل كـ <Badge variant="secondary">{status?.me?.email}</Badge> /{" "}
            <Badge>{status?.me?.role?.name}</Badge>
          </div>
          <div>عدد الجداول: {status?.collections?.length}</div>
          <div className="flex flex-wrap gap-2">
            {status?.hasLegacyAgents && <Badge variant="destructive">جدول قديم: agents</Badge>}
            {status?.hasLegacyRequestsFiles && (
              <Badge variant="destructive">جدول قديم: requests_files</Badge>
            )}
            {!status?.hasLegacyAgents && !status?.hasLegacyRequestsFiles && (
              <Badge variant="default" className="bg-green-600">
                لا توجد جداول قديمة ✓
              </Badge>
            )}
          </div>
          <div className="flex flex-wrap gap-1 pt-2">
            {status?.roles?.map((r: any) => (
              <Badge key={r.id} variant="outline">
                {r.name}
              </Badge>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Shield className="h-4 w-4" /> إصلاح الصلاحيات
            </CardTitle>
            <CardDescription>إضافة الصلاحيات الناقصة لـ Agent + تشديد Public</CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={runFixPermissions} disabled={running} className="w-full">
              {running ? <Loader2 className="h-4 w-4 animate-spin" /> : "تشغيل"}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Trash2 className="h-4 w-4" /> حذف القديم
            </CardTitle>
            <CardDescription>إزالة جداول agents و requests_files</CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              onClick={runCleanup}
              disabled={running || (!status?.hasLegacyAgents && !status?.hasLegacyRequestsFiles)}
              variant="destructive"
              className="w-full"
            >
              {running ? <Loader2 className="h-4 w-4 animate-spin" /> : "حذف"}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CheckCircle2 className="h-4 w-4" /> تشغيل الكل
            </CardTitle>
            <CardDescription>تنفيذ كل الإصلاحات دفعة واحدة</CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={runAll} disabled={running} className="w-full" variant="default">
              {running ? <Loader2 className="h-4 w-4 animate-spin" /> : "تشغيل الكل"}
            </Button>
          </CardContent>
        </Card>
      </div>

      {log.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>سجل التنفيذ</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1 font-mono text-xs">
              {log.map((l, i) => (
                <li key={i} className={l.ok ? "text-green-700" : "text-red-700"}>
                  {l.ok ? "✓" : "✗"} {l.msg}
                  {l.detail && (
                    <span className="text-muted-foreground"> — {JSON.stringify(l.detail)}</span>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
