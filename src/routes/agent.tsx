import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Component, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, FileText, Inbox, Copy, Check, Share2 } from "lucide-react";
import { toast } from "sonner";
import { DashboardShell } from "@/components/DashboardShell";
import { EmptyState } from "@/components/EmptyState";
import { StatusBadge } from "@/components/StatusBadge";
import { useLang } from "@/i18n/LanguageProvider";
import { useRequestsLive } from "@/hooks/useRequestsLive";
import {
  getCurrentUser,
  refreshCurrentUser,
  listAgents,
  type AuthUser,
  type InsuranceRequest,
  type RequestStatus,
} from "@/services/api";

export const Route = createFileRoute("/agent")({
  component: AgentDashboard,
});

type StatusFilter =
  | "all"
  | "new"
  | "quoted"
  | "linkSent"
  | "processing"
  | "sold"
  | "rejected"
  | "reupload";

function AgentDashboard() {
  return (
    <AgentDashboardRenderBoundary>
      <AgentDashboardContent />
    </AgentDashboardRenderBoundary>
  );
}

class AgentDashboardRenderBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error) {
    console.error("[agent dashboard render error]", error);
  }
  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen bg-background px-4 py-10 text-center text-foreground">
          <div className="mx-auto max-w-md rounded-2xl border border-border bg-card p-5 shadow-card">
            <h1 className="text-lg font-bold">Requests</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Unable to render one dashboard row. Please refresh.
            </p>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function AgentDashboardContent() {
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
      if (!fresh || fresh.role !== "agent") {
        navigate({ to: "/login" });
        return;
      }
      setUser(fresh);
    });
  }, [navigate]);

  // Always scope the dashboard by the logged-in Directus user id. Do not rely
  // on agent_code or a warmed agents cache for Sales Agent visibility.
  const effectiveAgentId = user?.id;
  const { items, loading, error } = useRequestsLive({ agentId: effectiveAgentId });

  // Underwriter / agent dashboard diagnostics — surfaces logged-in user id,
  // filter, and result count so visibility issues are easy to debug.
  useEffect(() => {
    if (!user) return;
    const safeItems = Array.isArray(items) ? items : [];
    console.info("[underwriter/agent dashboard]", {
      loggedInUserId: user?.id ?? null,
      loggedInAgentCode: user?.agentId ?? null,
      staffType: user?.staffType ?? null,
      queryFilter: { agentId: effectiveAgentId },
      loading,
      returnedCount: safeItems.length,
      statuses: safeItems.map((r) => ({
        id: safeText(r?.id, ""),
        status: safeStatus(r?.status),
        agent: safeText(r?.agentId, ""),
        assignedUW: safeText(r?.assignedUnderwriterId ?? r?.assignedUnderwriterUserId, ""),
      })),
    });
  }, [user, effectiveAgentId, items, loading]);

  // Detect newly-arrived customer requests and push a notification to the
  // logged-in agent so the bell + count update without requiring server-side
  // flows. First snapshot is "baseline" (no spam on initial load).
  const seenIdsRef = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!user || loading) return;
    const safeItems = Array.isArray(items) ? items : [];
    const ids = new Set(safeItems.map((r) => safeText(r?.id, "")).filter(Boolean));
    if (seenIdsRef.current === null) {
      seenIdsRef.current = ids;
      return;
    }
    const fresh = safeItems.filter((r) => !seenIdsRef.current!.has(safeText(r?.id, "")));
    seenIdsRef.current = ids;
    if (!fresh.length) return;
    const cutoff = Date.now() - 30 * 60 * 1000;
    const recent = fresh.filter((r) => {
      const t = Date.parse(safeText(r?.createdAt, ""));
      return !Number.isNaN(t) && t >= cutoff;
    });
    if (!recent.length) return;
    for (const r of recent) {
      toast.success(
        lang === "ar" ? `طلب جديد ${safeText(r?.id)}` : `New request ${safeText(r?.id)}`,
      );
    }
  }, [items, loading, user, lang]);

  const myStaffType = useMemo(
    () =>
      user?.staffType ??
      (effectiveAgentId
        ? listAgents().find((a) => a.id === effectiveAgentId || a.userId === effectiveAgentId)
            ?.staffType
        : undefined),
    [effectiveAgentId, user?.staffType],
  );
  const isUnderwriter = myStaffType === "underwriter";
  const linkedAgent = useMemo(
    () =>
      user
        ? listAgents().find(
            (a) => a.userId === user.id || a.id === user.agentId || a.id === effectiveAgentId,
          )
        : undefined,
    [effectiveAgentId, user],
  );
  const uploadLinkName =
    user?.name && user.name !== user.email ? user.name : (linkedAgent?.name ?? user?.name ?? "");
  const linkedAgentCode = linkedAgent?.id && !UUID_RE.test(linkedAgent.id) ? linkedAgent.id : undefined;
  const uploadLinkCode = user?.agentId && !UUID_RE.test(user.agentId) ? user.agentId : linkedAgentCode;
  const safeItems = useMemo(
    () => (Array.isArray(items) ? items : []).map(normalizeRequestForDashboard),
    [items],
  );

  const counts = useMemo(
    () => ({
      all: safeItems.length,
      new: safeItems.filter((r) => r.status === "new").length,
      quoted: safeItems.filter((r) => r.status === "quoted").length,
      linkSent: safeItems.filter((r) => r.status === "linkSent").length,
      processing: safeItems.filter((r) => r.status === "processing").length,
      sold: safeItems.filter((r) => r.status === "sold").length,
      rejected: safeItems.filter((r) => r.status === "rejected").length,
      reupload: safeItems.filter((r) => r.status === "reupload").length,
    }),
    [safeItems],
  );

  const stats = { total: counts.all, newReq: counts.new, sales: counts.sold };

  const filteredItems = useMemo(
    () => (filter === "all" ? safeItems : safeItems.filter((r) => r.status === filter)),
    [safeItems, filter],
  );

  const tabs: { key: StatusFilter; label: string; tone: string }[] = [
    { key: "all", label: lang === "ar" ? "الكل" : "All", tone: "bg-foreground text-background" },
    { key: "new", label: t.status.new, tone: "bg-info text-info-foreground" },
    { key: "processing", label: t.status.processing, tone: "bg-warning text-warning-foreground" },
    { key: "quoted", label: t.status.quoted, tone: "bg-info text-info-foreground" },
    { key: "linkSent", label: t.status.linkSent, tone: "bg-info text-info-foreground" },
    { key: "sold", label: t.status.sold, tone: "bg-success text-success-foreground" },
    { key: "reupload", label: t.status.reupload, tone: "bg-purple text-purple-foreground" },
    {
      key: "rejected",
      label: t.status.rejected,
      tone: "bg-destructive text-destructive-foreground",
    },
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
      {!isUnderwriter && (
        <ShareLinkCard
          agentId={effectiveAgentId ?? ""}
          agentCode={uploadLinkCode}
          agentName={uploadLinkName}
          agentEmail={user.email}
          firstName={user.firstName}
          lastName={user.lastName}
        />
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
                    active
                      ? "bg-primary-foreground/20 text-primary-foreground"
                      : "bg-muted text-muted-foreground"
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
              <tr>
                <td colSpan={4} className="px-5 py-12 text-center text-muted-foreground">
                  …
                </td>
              </tr>
            ) : filteredItems.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-5 py-8">
                  <EmptyState
                    icon={<Inbox className="h-7 w-7" />}
                    title={t.agent.emptyTitle}
                    subtitle={t.agent.emptySubtitle}
                  />
                </td>
              </tr>
            ) : (
              filteredItems.map((r) => (
                <tr key={r.id} className="border-t border-border transition hover:bg-muted/30">
                  <td className="px-5 py-4 font-semibold text-foreground">{r.id}</td>
                  <td className="px-5 py-4 text-muted-foreground">
                    {formatDashboardDate(r.createdAt, lang)}
                  </td>
                  <td className="px-5 py-4">
                    <StatusBadge status={r.status} />
                  </td>
                  <td className="px-5 py-4">
                    <Link
                      to="/requests/$id"
                      params={{ id: r.id }}
                      className="inline-flex items-center gap-1 rounded-lg bg-primary-soft px-3 py-1.5 text-sm font-semibold text-primary transition hover:bg-primary-soft/70 active:scale-95"
                    >
                      {t.table.view} <Chevron className="h-4 w-4" />
                    </Link>
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
              <Link to="/requests/$id" params={{ id: r.id }} className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary-soft text-primary">
                  <FileText className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-foreground">{r.id}</span>
                    <StatusBadge status={r.status} />
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {formatDashboardDate(r.createdAt, lang)}
                  </div>
                </div>
                <Chevron className="h-5 w-5 text-muted-foreground" />
              </Link>
            </div>
          ))
        )}
      </div>
    </DashboardShell>
  );
}

function Chip({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "primary" | "info" | "success";
}) {
  const tones = {
    primary: "bg-primary-soft text-primary",
    info: "bg-info/10 text-info",
    success: "bg-success/10 text-success",
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${tones[tone]}`}
    >
      <span className="opacity-80">{label}</span>
      <span className="font-bold">{value}</span>
    </span>
  );
}

type DashboardRequest = {
  id: string;
  status: RequestStatus;
  createdAt: string;
  agentId: string;
  assignedUnderwriterId?: string;
  assignedUnderwriterUserId?: string;
};

const VALID_STATUSES: RequestStatus[] = [
  "new",
  "processing",
  "reupload",
  "quoted",
  "linkSent",
  "sold",
  "rejected",
];

function safeText(value: unknown, fallback = "—"): string {
  if (typeof value === "string") return value.trim() || fallback;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return safeText(obj.agent_code ?? obj.code ?? obj.name ?? obj.id, fallback);
  }
  return fallback;
}

function safeLower(value: unknown): string {
  return safeText(value, "").toString().toLowerCase();
}

function emailUsername(value: unknown): string {
  const raw = safeText(value, "");
  return raw && raw.includes("@") ? raw.split("@")[0] : "";
}

function safeStatus(value: unknown): RequestStatus {
  return VALID_STATUSES.includes(value as RequestStatus) ? (value as RequestStatus) : "new";
}

function normalizeRequestForDashboard(
  req: Partial<InsuranceRequest> | null | undefined,
): DashboardRequest {
  const id = safeText(req?.id, "REQ-UNKNOWN");
  return {
    id,
    status: safeStatus(req?.status),
    createdAt: safeText(req?.createdAt, ""),
    agentId: safeText(req?.agentId, ""),
    assignedUnderwriterId: safeText(req?.assignedUnderwriterId, ""),
    assignedUnderwriterUserId: safeText(req?.assignedUnderwriterUserId, ""),
  };
}

function formatDashboardDate(value: unknown, lang: string): string {
  const raw = safeText(value, "");
  const date = raw ? new Date(raw) : null;
  if (!date || Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(lang === "ar" ? "ar-AE" : "en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function slugify(s: unknown): string {
  return safeLower(s)
    .replace(/[\u0600-\u06FF]+/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Build a readable, non-UUID slug for the customer upload link. We NEVER
// expose the raw Directus user id in any agent-facing or customer-facing
// link. Inputs are tried in priority order: name+code, email-username+code,
// code alone, then email-username alone. A UUID input is rejected so an
// accidental `agentId` value can never leak.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function buildAgentUploadSlug(input: {
  name?: string | null;
  email?: string | null;
  agentCode?: string | null;
  firstName?: string | null;
  lastName?: string | null;
}): string {
  const firstLast = [input.firstName, input.lastName].filter(Boolean).join(" ").trim();
  const displayName = safeText(firstLast || input.name, "");
  const namePart = displayName && displayName !== input.email ? slugify(displayName) : "";
  const rawCode = safeText(input.agentCode, "");
  const codePart = rawCode && !UUID_RE.test(rawCode) ? slugify(rawCode) : "";
  const emailUser = slugify(emailUsername(input.email));
  const candidates = [
    [namePart, codePart].filter(Boolean).join("-"),
    namePart,
    [emailUser, codePart].filter(Boolean).join("-"),
    emailUser,
    codePart,
  ];
  for (const c of candidates) {
    if (c && !UUID_RE.test(c)) return c;
  }
  return namePart || emailUser || codePart;
}

function ShareLinkCard({
  agentId,
  agentCode,
  agentName,
  agentEmail,
  firstName,
  lastName,
}: {
  agentId: string;
  agentCode?: string;
  agentName: string;
  agentEmail?: string;
  firstName?: string;
  lastName?: string;
}) {
  const { t, lang } = useLang();
  const [copied, setCopied] = useState(false);

  const slug = useMemo(
    () => buildAgentUploadSlug({ name: agentName, email: agentEmail, agentCode, firstName, lastName }),
    [agentName, agentCode, agentEmail, firstName, lastName],
  );

  const link = useMemo(() => {
    if (typeof window === "undefined") return "";
    const finalSlug = slug || slugify(agentName) || slugify(emailUsername(agentEmail));
    return finalSlug ? `${window.location.origin}/?agent=${encodeURIComponent(finalSlug)}` : "";
  }, [agentEmail, agentName, slug]);

  useEffect(() => {
    console.info("[agent upload link] user fields", {
      first_name: firstName ?? (agentName || "").split(" ")[0],
      last_name: lastName ?? (agentName || "").split(" ").slice(1).join(" "),
      name: agentName,
      email: agentEmail,
      agent_code: agentCode,
      agentId,
    });
    console.info("[agent upload link] final slug", slug);
    console.info("[agent upload link] final url", link);
  }, [link, slug, agentName, agentEmail, agentCode, agentId, firstName, lastName]);

  const writeToClipboard = async (text: string) => {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    textarea.style.top = "0";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(textarea);
    if (!ok) throw new Error("Copy failed");
  };

  const copy = async () => {
    try {
      if (!link) {
        toast.error(lang === "ar" ? "تعذر إنشاء الرابط" : "Link unavailable");
        return;
      }
      await writeToClipboard(link);
      setCopied(true);
      toast.success(lang === "ar" ? "تم نسخ الرابط" : "Link copied");
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error(lang === "ar" ? "تعذر النسخ" : "Copy failed");
    }
  };

  const share = async () => {
    if (!link) {
      toast.error(lang === "ar" ? "تعذر إنشاء الرابط" : "Link unavailable");
      return;
    }
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

  // Never hide the card for Sales Agents. Even with sparse user fields the
  // slug helper falls back to a generic value so the link is always shown.

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
        {!!(agentCode || slug) && !UUID_RE.test(String(agentCode || slug)) && (
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">
            {agentCode || slug}
          </span>
        )}
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
            {copied ? (lang === "ar" ? "تم النسخ" : "Copied") : lang === "ar" ? "نسخ" : "Copy"}
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
