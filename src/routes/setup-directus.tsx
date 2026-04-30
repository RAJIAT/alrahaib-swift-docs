import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { CheckCircle2, ChevronLeft, Loader2, Rocket, XCircle } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { DashboardShell } from "@/components/DashboardShell";
import { getCurrentUser } from "@/services/api";
import { setupDirectus } from "@/server/directus-setup.functions";

export const Route = createFileRoute("/setup-directus")({
  component: SetupDirectusPage,
});

type Step = { step: string; ok: boolean; detail?: string };
type Result = {
  success: boolean;
  total?: number;
  ok?: number;
  failed?: number;
  steps: Step[];
  error?: string;
};

function SetupDirectusPage() {
  const navigate = useNavigate();
  const runSetup = useServerFn(setupDirectus);

  const [url, setUrl] = useState("http://74.162.122.193:8055");
  const [token, setToken] = useState("Ku-owyi9r8CzuyI8SlIHTqPD2Yu04OKp");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  useEffect(() => {
    const u = getCurrentUser();
    if (!u || u.role !== "admin") navigate({ to: "/login" });
  }, [navigate]);

  const onRun = async () => {
    setRunning(true);
    setResult(null);
    try {
      const res = await runSetup({ data: { url, token } });
      setResult(res as Result);
    } catch (e: any) {
      setResult({ success: false, steps: [], error: e?.message ?? "Request failed" });
    } finally {
      setRunning(false);
    }
  };

  return (
    <DashboardShell role="admin">
      <div className="mx-auto max-w-3xl p-4 sm:p-6">
        <Link
          to="/admin"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" />
          الرجوع
        </Link>

        <div className="mt-4 rounded-2xl border border-border bg-card p-6 shadow-card">
          <div className="flex items-center gap-3">
            <div className="grid h-12 w-12 place-items-center rounded-xl bg-primary/10 text-primary">
              <Rocket className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground">إعداد Directus التلقائي</h1>
              <p className="text-sm text-muted-foreground">
                ينشئ الـ collections والحقول والصلاحيات بضغطة وحدة
              </p>
            </div>
          </div>

          <div className="mt-6 space-y-4">
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-foreground">Directus URL</span>
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                disabled={running}
                className="h-12 w-full rounded-xl border border-input bg-surface px-4 font-mono text-sm text-foreground outline-none ring-primary focus:ring-2"
                dir="ltr"
              />
            </label>

            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-foreground">
                Static Token (Admin)
              </span>
              <input
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                disabled={running}
                className="h-12 w-full rounded-xl border border-input bg-surface px-4 font-mono text-sm text-foreground outline-none ring-primary focus:ring-2"
                dir="ltr"
              />
              <span className="mt-1 block text-xs text-muted-foreground">
                من Directus → User Directory → Admin → Token
              </span>
            </label>

            <button
              onClick={onRun}
              disabled={running || !url || !token}
              className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-primary-foreground shadow-soft transition hover:opacity-90 disabled:opacity-50"
            >
              {running ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  جاري التنفيذ...
                </>
              ) : (
                <>
                  <Rocket className="h-4 w-4" />
                  بدء الإعداد
                </>
              )}
            </button>
          </div>
        </div>

        {result && (
          <div className="mt-4 rounded-2xl border border-border bg-card p-6 shadow-card">
            {result.error ? (
              <div className="rounded-xl bg-destructive/10 p-4 text-sm font-medium text-destructive">
                ❌ {result.error}
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-bold text-foreground">
                    {result.success ? "✅ اكتمل بنجاح" : "⚠️ اكتمل مع تحذيرات"}
                  </h2>
                  <span className="text-sm text-muted-foreground">
                    {result.ok}/{result.total} نجح
                  </span>
                </div>

                <ul className="mt-4 max-h-[420px] space-y-1.5 overflow-auto">
                  {result.steps.map((s, i) => (
                    <li
                      key={i}
                      className="flex items-start gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-sm"
                    >
                      {s.ok ? (
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-600" />
                      ) : (
                        <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-foreground">{s.step}</div>
                        {s.detail && (
                          <div className="text-xs text-muted-foreground">{s.detail}</div>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>

                {result.success && (
                  <div className="mt-4 rounded-xl bg-primary/10 p-4 text-sm text-foreground">
                    <p className="font-semibold">الخطوات التالية:</p>
                    <ol className="mt-2 list-decimal space-y-1 ps-5 text-muted-foreground">
                      <li>افتح Directus → Settings → Roles → Agent وأضف فلتر RLS</li>
                      <li>أنشئ أول Agent من شاشة User Directory</li>
                      <li>
                        ضيف <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">VITE_DIRECTUS_URL</code>{" "}
                        بملف <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">.env</code>
                      </li>
                    </ol>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </DashboardShell>
  );
}
