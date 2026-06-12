import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, FileText, Inbox, Copy, Check, Share2 } from "lucide-react";
import { toast } from "sonner";
import { DashboardShell } from "@/components/DashboardShell";
import { EmptyState } from "@/components/EmptyState";
import { StatusBadge } from "@/components/StatusBadge";
import { useLang } from "@/i18n/LanguageProvider";
import { useRequestsLive } from "@/hooks/useRequestsLive";
import { getCurrentUser, refreshCurrentUser, listAgents, type AuthUser } from "@/services/api";

export const Route = createFileRoute("/agent")({
  component: AgentDashboard,
});

type StatusFilter = "all" | "new" | "processing" | "sold" | "rejected" | "reupload";

function AgentDashboard() {
  const { t, dir, lang } = useLang();
  const navigate = useNavigate();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [filter, setFilter] = useState<StatusFilter>("all");

  useEffect(() => {
    const u = getCurrentUser();
    if (!u || u.role !== "agent") {
      navigate({ to: "/login" });
      return;
    }
    setUser(u);
    // Re-verify role server-side; if tampered, send to login.
    refreshCurrentUser().then((fresh) => {
      if (!fresh || fresh.role !== "agent") { navigate({ to: "/login" }); return; }
      setUser(fresh);
    });
  }, [navigate]);

  const { items, loading } = useRequestsLive(user?.agentId ? { agentId: user.agentId } : undefined);
  const myStaffType = useMemo(
    () => (user?.agentId ? listAgents().find((a) => a.id === user.agentId)?.staffType : undefined),
    [user?.agentId],
  );
  const isUnderwriter = myStaffType === "underwriter";

  const counts = useMemo(
    () => ({
      all: items.length,
      new: items.filter((r) => r.status === "new").length,
      processing: items.filter((r) => r.status === "processing").length,
      sold: items.filter((r) => r.status === "sold").length,
      rejected: items.filter((r) => r.status === "rejected").length,
      reupload: items.filter((r) => r.status === "reupload").length,
    }),
    [items],
  );

  const stats = { total: counts.all, newReq: counts.new, sales: counts.sold };

  const filteredItems = useMemo(
    () => (filter === "all" ? items : items.filter((r) => r.status === filter)),
    [items, filter],
  );

  const tabs: { key: StatusFilter; label: string; tone: string }[] = [
    { key: "all", label: lang === "ar" ? "الكل" : "All", tone: "bg-foreground text-background" },
    { key: "new", label: t.status.new, tone: "bg-info text-info-foreground" },
    { key: "processing", label: t.status.processing, tone: "bg-warning text-warning-foreground" },
    { key: "sold", label: t.status.sold, tone: "bg-success text-success-foreground" },
    { key: "reupload", label: t.status.reupload, tone: "bg-purple text-purple-foreground" },
    { key: "rejected", label: t.status.rejected, tone: "bg-destructive text-destructive-foreground" },
  ];

  const Chevron = dir === "rtl" ? ChevronLeft : ChevronRight;

  if (!user) return null;

  return (
    <DashboardShell role="agent" title={t.nav.requests}>
      {/* Header strip */}
      <div className="mb-4 rounded-2xl border border-border bg-card p-4 shadow-card animate-fade-in">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-foreground">
              {t.agent.welcome}, {user.name}
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">{t.agent.yoursOnly}</div>
          </div>
          <div className="flex items-center gap-2">
            <Chip label={t.agent.statsTotal} value={stats.total} tone="primary" />
            <Chip label={t.agent.statsNew} value={stats.newReq} tone="info" />
            <Chip label={t.agent.statsSold} value={stats.sales} tone="success" />
          </div>
        </div>
      </div>

      {/* Agent's permanent personal customer-upload link — sales only. */}
      {!isUnderwriter && user.agentId && (
        <ShareLinkCard agentId={user.agentId} agentName={user.name} />
      )}
      {/* Status filter tabs */}
      <div className="mb-4 -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <div className="flex w-max gap-2 sm:w-auto sm:flex-wrap">
          {tabs.map((tab) => {
            const active = filter === tab.key;
            const count = counts[tab.key];
            return (
              <button
                key={tab.key}
                onClick={() => setFilter(tab.key)}
                className={`inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm font-semibold transition active:scale-95 ${
                  active
                    ? "border-transparent bg-primary text-primary-foreground shadow-soft"
                    : "border-border bg-card text-foreground hover:bg-muted"
                }`}
              >
                <span>{tab.label}</span>
                <span
                  className={`inline-flex min-w-[1.25rem] items-center justify-center rounded-full px-1.5 text-[11px] font-bold ${
                    active ? "bg-primary-foreground/20 text-primary-foreground" : "bg-muted text-muted-foreground"
                  }`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Desktop table */}
      <div className="hidden overflow-hidden rounded-2xl border border-border bg-card shadow-card md:block">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-muted-foreground">
            <tr className={dir === "rtl" ? "text-right" : "text-left"}>
              <th className="px-5 py-3 font-semibold">{t.table.requestId}</th>
              <th className="px-5 py-3 font-semibold">{t.table.date}</th>
              <th className="px-5 py-3 font-semibold">{t.table.status}</th>
              <th className="px-5 py-3 font-semibold">{t.table.action}</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={4} className="px-5 py-12 text-center text-muted-foreground">…</td></tr>
            ) : filteredItems.length === 0 ? (
              <tr><td colSpan={4} className="px-5 py-8">
                <EmptyState
                  icon={<Inbox className="h-7 w-7" />}
                  title={t.agent.emptyTitle}
                  subtitle={t.agent.emptySubtitle}
                />
              </td></tr>
            ) : (
              filteredItems.map((r) => (
                <tr key={r.id} className="border-t border-border transition hover:bg-muted/30">
                  <td className="px-5 py-4 font-semibold text-foreground">{r.id}</td>
                  <td className="px-5 py-4 text-muted-foreground">
                    {new Date(r.createdAt).toLocaleString(lang === "ar" ? "ar-AE" : "en-GB", {
                      dateStyle: "medium", timeStyle: "short",
                    })}
                  </td>
                  <td className="px-5 py-4"><StatusBadge status={r.status} /></td>
                  <td className="px-5 py-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        to="/requests/$id"
                        params={{ id: r.id }}
                        className="inline-flex items-center gap-1 rounded-lg bg-primary-soft px-3 py-1.5 text-sm font-semibold text-primary transition hover:bg-primary-soft/70 active:scale-95"
                      >
                        {t.table.view} <Chevron className="h-4 w-4" />
                      </Link>
                      {!isUnderwriter && (
                        <>
                          <button
                            onClick={() => copyLink(r.id)}
                            className="inline-flex items-center gap-1 rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs font-semibold text-foreground transition hover:bg-muted"
                            title={lang === "ar" ? "نسخ رابط الرفع" : "Copy upload link"}
                          >
                            <Copy className="h-3.5 w-3.5" />
                            {lang === "ar" ? "نسخ الرابط" : "Copy link"}
                          </button>
                          <a
                            href={uploadUrl(r.id)}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs font-semibold text-foreground transition hover:bg-muted"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                            {lang === "ar" ? "فتح" : "Open"}
                          </a>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="space-y-3 md:hidden">
        {loading ? (
          <p className="py-8 text-center text-muted-foreground">…</p>
        ) : filteredItems.length === 0 ? (
          <EmptyState
            icon={<Inbox className="h-7 w-7" />}
            title={t.agent.emptyTitle}
            subtitle={t.agent.emptySubtitle}
          />
        ) : (
          filteredItems.map((r) => (
            <div
              key={r.id}
              className="animate-fade-in rounded-2xl border border-border bg-card p-4 shadow-card"
            >
              <Link
                to="/requests/$id"
                params={{ id: r.id }}
                className="flex items-center gap-3"
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary-soft text-primary">
                  <FileText className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-foreground">{r.id}</span>
                    <StatusBadge status={r.status} />
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {new Date(r.createdAt).toLocaleString(lang === "ar" ? "ar-AE" : "en-GB", {
                      dateStyle: "medium", timeStyle: "short",
                    })}
                  </div>
                </div>
                <Chevron className="h-5 w-5 text-muted-foreground" />
              </Link>
              {!isUnderwriter && (
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={() => copyLink(r.id)}
                    className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-primary-soft px-3 py-2 text-xs font-semibold text-primary"
                  >
                    <Copy className="h-3.5 w-3.5" />
                    {lang === "ar" ? "نسخ الرابط" : "Copy link"}
                  </button>
                  <a
                    href={uploadUrl(r.id)}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-border bg-card px-3 py-2 text-xs font-semibold text-foreground"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    {lang === "ar" ? "فتح" : "Open"}
                  </a>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </DashboardShell>
  );
}

function Chip({ label, value, tone }: { label: string; value: number; tone: "primary" | "info" | "success" }) {
  const tones = {
    primary: "bg-primary-soft text-primary",
    info: "bg-info/10 text-info",
    success: "bg-success/10 text-success",
  };
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${tones[tone]}`}>
      <span className="opacity-80">{label}</span>
      <span className="font-bold">{value}</span>
    </span>
  );
}

function CreateRequestCard({ onCreated }: { onCreated: (id: string) => void }) {
  const { lang } = useLang();
  const [busy, setBusy] = useState(false);

  const onClick = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const req = await createEmptyRequest();
      toast.success(lang === "ar" ? `تم إنشاء الطلب ${req.id}` : `Created ${req.id}`);
      onCreated(req.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(msg || (lang === "ar" ? "تعذر إنشاء الطلب" : "Failed to create request"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mb-5 flex flex-col gap-3 rounded-2xl border border-primary/20 bg-gradient-to-br from-primary-soft to-card p-4 shadow-card animate-fade-in sm:flex-row sm:items-center sm:justify-between">
      <div>
        <div className="text-sm font-bold text-foreground">
          {lang === "ar" ? "إنشاء طلب جديد" : "Create a new request"}
        </div>
        <div className="mt-0.5 text-xs text-muted-foreground">
          {lang === "ar"
            ? "أنشئ طلباً جديداً واحصل على رابط رفع خاص بالعميل"
            : "Generate a customer upload link for a new request"}
        </div>
      </div>
      <button
        onClick={onClick}
        disabled={busy}
        className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-primary px-5 text-sm font-bold text-primary-foreground shadow-soft transition active:scale-95 disabled:opacity-60"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
        {lang === "ar" ? "إنشاء طلب / رابط رفع" : "Create Request / Upload Link"}
      </button>
    </div>
  );
}

function ShareLinkCard({ agentId, agentName }: { agentId: string; agentName: string }) {
  const { t, lang } = useLang();
  const [copied, setCopied] = useState(false);

  const link = useMemo(() => {
    if (typeof window === "undefined") return "";
    return `${window.location.origin}/?agent=${encodeURIComponent(agentId)}`;
  }, [agentId]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      toast.success(lang === "ar" ? "تم نسخ الرابط" : "Link copied");
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error(lang === "ar" ? "تعذر النسخ" : "Copy failed");
    }
  };

  const share = async () => {
    const shareText =
      lang === "ar"
        ? `مرحباً، فضلاً ارفع مستنداتك من خلال الرابط التالي:\n${link}`
        : `Hello, please upload your documents using this link:\n${link}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: agentName, text: shareText, url: link });
      } catch {
        /* user cancelled */
      }
    } else {
      window.open(`https://wa.me/?text=${encodeURIComponent(shareText)}`, "_blank");
    }
  };

  if (!agentId) return null;

  return (
    <div className="mb-5 rounded-2xl border border-primary/20 bg-gradient-to-br from-primary-soft to-card p-4 shadow-card animate-fade-in">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-sm font-bold text-foreground">
            {lang === "ar" ? "رابطك الخاص للعملاء" : "Your client upload link"}
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            {lang === "ar"
              ? "ابعث هذا الرابط لعميلك ليرفع مستنداته مباشرة لحسابك"
              : "Send this link to your client to upload documents directly to your account"}
          </div>
        </div>
        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">
          {agentId}
        </span>
      </div>

      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
        <div
          dir="ltr"
          className="flex-1 truncate rounded-xl border border-border bg-surface px-3 py-2.5 text-xs font-mono text-foreground"
        >
          {link}
        </div>
        <div className="flex gap-2">
          <button
            onClick={copy}
            className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-soft transition active:scale-95"
          >
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {copied
              ? lang === "ar" ? "تم النسخ" : "Copied"
              : lang === "ar" ? "نسخ" : "Copy"}
          </button>
          <button
            onClick={share}
            className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-border bg-surface px-4 text-sm font-semibold text-foreground transition hover:bg-muted active:scale-95"
          >
            <Share2 className="h-4 w-4" />
            {lang === "ar" ? "مشاركة" : "Share"}
          </button>
        </div>
      </div>
    </div>
  );
}
