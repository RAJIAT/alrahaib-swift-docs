import { createFileRoute, Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Check, ShieldCheck, User, Zap, LogIn, Send, Clock, FileImage, IdCard, BadgeCheck, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { Logo } from "@/components/Logo";
import { DocumentRow } from "@/components/DocumentRow";
import { OptionalDocsSection } from "@/components/OptionalDocsSection";
import { useLang } from "@/i18n/LanguageProvider";
import { submitUpload } from "@/services/api";
import { dxResolveUploadAgent } from "@/services/directusRequests";

type Search = { agent?: string };

export const Route = createFileRoute("/")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    agent: typeof s.agent === "string" ? s.agent : undefined,
  }),
  component: UploadPage,
});

function UploadPage() {
  const { t, dir } = useLang();
  const navigate = useNavigate();
  const { agent } = useSearch({ from: "/" });
  const [agentName, setAgentName] = useState<string | null>(null);

  useEffect(() => {
    if (!agent) { setAgentName(null); return; }
    let alive = true;
    dxResolveUploadAgent(agent)
      .then((a) => { if (alive) setAgentName(a.name || null); })
      .catch(() => { if (alive) setAgentName(null); });
    return () => { alive = false; };
  }, [agent]);

  // Derive a clean readable fallback from the slug so we never render dots,
  // a UUID, or the raw agent code. Example:
  //   raji-atiyah-sls-8039 -> "Raji Atiyah"
  //   sls-8039             -> "" (just a code, no readable name)
  const slugFallbackName = useMemo(() => {
    if (!agent) return "";
    const raw = agent.trim();
    // Strip a trailing agent-code segment like "-sls-8039" or "-uw-12".
    const withoutCode = raw.replace(/-[a-z]+-\d+$/i, "");
    // If only the code remained, we have no readable name to derive.
    if (!withoutCode || withoutCode === raw && /^[a-z]+-?\d+$/i.test(raw)) return "";
    const cleaned = withoutCode
      .replace(/[^a-zA-Z\u00C0-\u024F\u0600-\u06FF\s-]/g, " ")
      .replace(/[-_]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!cleaned) return "";
    return cleaned
      .split(" ")
      .map((w) => (w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w))
      .join(" ");
  }, [agent]);

  const agentLabel = dir === "rtl" ? "الوكيل" : "Agent";
  const agentDisplayName = agentName || slugFallbackName;

  // Required documents
  const [registration, setRegistration] = useState<File[]>([]);
  const [emirates, setEmirates] = useState<File[]>([]);
  const [license, setLicense] = useState<File[]>([]);
  // Optional documents
  const [vehicleMedia, setVehicleMedia] = useState<File[]>([]);
  const [inspectionFiles, setInspectionFiles] = useState<File[]>([]);
  const [attachments, setAttachments] = useState<File[]>([]);
  const inspection = inspectionFiles[0] ?? null;

  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [errors, setErrors] = useState<{ name?: string; email?: string; phone?: string }>({});
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const kycRef = useRef<HTMLElement | null>(null);
  const scrollToKyc = () => {
    kycRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const registrationOk = registration.length >= 1;
  const emiratesOk = emirates.length >= 1;
  const licenseOk = license.length >= 1;
  const completed = [registrationOk, emiratesOk, licenseOk].filter(Boolean).length;
  const docsReady = completed === 3;
  const remaining = 3 - completed;

  const kycSchema = useMemo(
    () =>
      z.object({
        customerName: z
          .string()
          .trim()
          .min(1, t.upload.errors.nameRequired)
          .min(2, t.upload.errors.nameTooShort)
          .max(100),
        customerEmail: z
          .string()
          .trim()
          .min(1, t.upload.errors.emailRequired)
          .email(t.upload.errors.emailInvalid)
          .max(255),
        customerPhone: z
          .string()
          .trim()
          .max(20)
          .regex(/^\+?[0-9\s-]{0,20}$/, t.upload.errors.phoneInvalid)
          .optional()
          .or(z.literal("")),
      }),
    [t],
  );

  const kycValid = kycSchema.safeParse({ customerName, customerEmail, customerPhone }).success;
  const ready = docsReady && kycValid;

  const onSubmit = async () => {
    const parsed = kycSchema.safeParse({ customerName, customerEmail, customerPhone });
    const missing: string[] = [];
    if (!registrationOk) missing.push(t.upload.cards.registration);
    if (!emiratesOk) missing.push(t.upload.cards.emirates);
    if (!licenseOk) missing.push(t.upload.cards.license);
    if (!parsed.success) {
      const fieldErrors: { name?: string; email?: string; phone?: string } = {};
      for (const issue of parsed.error.issues) {
        if (issue.path[0] === "customerName") fieldErrors.name = issue.message;
        if (issue.path[0] === "customerEmail") fieldErrors.email = issue.message;
        if (issue.path[0] === "customerPhone") fieldErrors.phone = issue.message;
      }
      setErrors(fieldErrors);
      if (missing.length > 0) toast.error(t.upload.errors.missingDocs(missing.join("، ")));
      scrollToKyc();
      return;
    }
    setErrors({});
    if (missing.length > 0) {
      toast.error(t.upload.errors.missingDocs(missing.join("، ")));
      return;
    }
    if (!agent || !agent.trim()) {
      toast.error(
        dir === "rtl"
          ? "رابط غير صالح: لا يوجد معرّف وكيل. يرجى استخدام الرابط الذي زوّدك به الوكيل."
          : "Invalid link: no agent ID. Please use the link your agent shared with you.",
      );
      return;
    }
    setSubmitting(true);
    try {
      const { id } = await submitUpload({
        agentId: agent,
        customerName: parsed.data.customerName,
        customerEmail: parsed.data.customerEmail,
        customerPhone: parsed.data.customerPhone,
        images: {
          registration,
          license,
          emirates,
          vehicleMedia,
          attachments,
        },
        optional: { inspection },
      });
      setDone(true);
      setTimeout(
        () => navigate({ to: "/success", search: { id, ...(agent ? { agent } : {}) } }),
        600,
      );
    } catch (err) {
      console.error("Upload failed:", err);
      const raw = err instanceof Error ? err.message : String(err);
      // Never expose internal Directus permission/field text to the customer.
      const isInternal = /directus_files|permission to access|Queried in/i.test(raw);
      const friendly = isInternal
        ? dir === "rtl"
          ? "تعذّر رفع الملفات. حاول مرة أخرى أو استخدم صور أصغر."
          : "Could not upload your files. Please try again or use smaller images."
        : `${dir === "rtl" ? "تعذّر الرفع" : "Upload failed"}: ${raw}`;
      toast.error(friendly);
      setDone(false);
      setSubmitting(false);
    }
  };

  return (
    <div className="bg-background animate-fade-in">
      <header className="px-4 pt-5">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-2">
          <LanguageSwitcher />
          <div className="flex items-center gap-2">
            {agent ? (
              <span className="text-xs text-muted-foreground">
                {`${agentLabel}: ${agentDisplayName || (dir === "rtl" ? "جارٍ التحميل…" : "Loading…")}`}
              </span>
            ) : (
              <Link
                to="/login"
                className="inline-flex h-9 items-center gap-1.5 rounded-full border border-border bg-surface px-3 text-xs font-semibold text-foreground shadow-soft transition hover:bg-muted active:scale-95"
              >
                <LogIn className="h-3.5 w-3.5" />
                {t.nav?.login ?? "Login"}
              </Link>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 pt-6">
        <div className="flex flex-col items-center text-center">
          <button
            type="button"
            onClick={scrollToKyc}
            aria-label={t.upload.kyc.title}
            className="rounded-full transition hover:opacity-80 active:scale-95 focus:outline-none focus:ring-2 focus:ring-primary/30"
          >
            <Logo size={56} />
          </button>
          <h1 className="mt-5 text-2xl font-bold leading-tight text-foreground sm:text-3xl">
            {t.upload.title}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground sm:text-base">
            {t.upload.subtitle}
          </p>

          <div className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-primary-soft px-3 py-1.5 text-xs font-semibold text-primary">
            <ShieldCheck className="h-3.5 w-3.5" />
            <span>{t.hero.trust}</span>
          </div>
          <p className="mt-3 max-w-md text-xs leading-relaxed text-muted-foreground sm:text-sm">
            {t.hero.valueProp}
          </p>
          <div className="mt-3 inline-flex items-center gap-1 rounded-full border border-border bg-surface px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground">
            <Zap className="h-3 w-3 text-warning-foreground" />
            <span>{t.brand}</span>
          </div>
        </div>

        {/* KYC card */}
        <section
          ref={kycRef}
          id="kyc-section"
          className="mt-8 scroll-mt-6 rounded-2xl border border-border bg-card p-5 shadow-card"
          dir={dir}
        >
          <div className="mb-4 flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary">
              <User className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-foreground">{t.upload.kyc.title}</h2>
              <p className="text-xs text-muted-foreground">{t.upload.kyc.subtitle}</p>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3">
            <div>
              <label htmlFor="customerName" className="mb-1.5 block text-xs font-semibold text-foreground">
                {t.upload.kyc.nameLabel} <span className="text-destructive">*</span>
              </label>
              <input
                id="customerName"
                type="text"
                value={customerName}
                maxLength={100}
                onChange={(e) => { setCustomerName(e.target.value); if (errors.name) setErrors((p) => ({ ...p, name: undefined })); }}
                placeholder={t.upload.kyc.namePlaceholder}
                className={`h-11 w-full rounded-xl border bg-surface px-3 text-sm text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 ${
                  errors.name ? "border-destructive" : "border-input"
                }`}
              />
              {errors.name && <p className="mt-1 text-xs font-medium text-destructive">{errors.name}</p>}
            </div>
            <div>
              <label htmlFor="customerEmail" className="mb-1.5 block text-xs font-semibold text-foreground">
                {t.upload.kyc.emailLabel} <span className="text-destructive">*</span>
              </label>
              <input
                id="customerEmail"
                type="email"
                value={customerEmail}
                maxLength={255}
                inputMode="email"
                autoComplete="email"
                onChange={(e) => { setCustomerEmail(e.target.value); if (errors.email) setErrors((p) => ({ ...p, email: undefined })); }}
                placeholder={t.upload.kyc.emailPlaceholder}
                className={`h-11 w-full rounded-xl border bg-surface px-3 text-sm text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 ${
                  errors.email ? "border-destructive" : "border-input"
                }`}
                dir="ltr"
              />
              {errors.email && <p className="mt-1 text-xs font-medium text-destructive">{errors.email}</p>}
            </div>
            <div>
              <label htmlFor="customerPhone" className="mb-1.5 block text-xs font-semibold text-foreground">
                {t.upload.kyc.phoneLabel}
              </label>
              <input
                id="customerPhone"
                type="tel"
                value={customerPhone}
                maxLength={20}
                inputMode="tel"
                autoComplete="tel"
                onChange={(e) => { setCustomerPhone(e.target.value); if (errors.phone) setErrors((p) => ({ ...p, phone: undefined })); }}
                placeholder={t.upload.kyc.phonePlaceholder}
                className={`h-11 w-full rounded-xl border bg-surface px-3 text-sm text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 ${
                  errors.phone ? "border-destructive" : "border-input"
                }`}
                dir="ltr"
              />
              {errors.phone && <p className="mt-1 text-xs font-medium text-destructive">{errors.phone}</p>}
            </div>
          </div>
        </section>

        {/* Essential documents — compact rows */}
        <section className="mt-6 space-y-3" dir={dir}>
          <h2 className="flex items-center gap-2 px-1 text-sm font-bold text-foreground">
            <span className="h-2 w-2 rounded-full bg-primary" />
            {t.upload.essentialDocs}
          </h2>
          <DocumentRow
            icon={FileImage}
            label={t.upload.cards.registration}
            required
            files={registration}
            onChange={setRegistration}
          />
          <DocumentRow
            icon={IdCard}
            label={t.upload.cards.license}
            required
            files={license}
            onChange={setLicense}
          />
          <DocumentRow
            icon={BadgeCheck}
            label={t.upload.cards.emirates}
            required
            files={emirates}
            onChange={setEmirates}
          />
        </section>

        <p className="mt-5 text-center text-sm font-medium text-muted-foreground">
          {docsReady ? t.upload.allDone : t.upload.remaining(remaining)}
        </p>

        {/* Optional documents — collapsible section */}
        <section className="mt-6" dir={dir}>
          <OptionalDocsSection
            vehicleMedia={vehicleMedia}
            setVehicleMedia={setVehicleMedia}
            inspection={inspectionFiles}
            setInspection={setInspectionFiles}
            attachments={attachments}
            setAttachments={setAttachments}
          />
        </section>
      </main>

      <div className="mx-auto mt-8 max-w-2xl px-4 pb-4">
        <button
          disabled={submitting}
          onClick={onSubmit}
          className="inline-flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-primary text-base font-bold text-primary-foreground shadow-elevated transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {done ? (
            <>
              <Check className="h-5 w-5 animate-scale-in" />
              {t.success.title}
            </>
          ) : submitting ? (
            <>
              <Loader2 className="h-5 w-5 animate-spin" />
              {t.upload.uploadingDocs}
            </>
          ) : (
            <>
              <Send className="h-5 w-5" />
              {t.upload.submit}
            </>
          )}
        </button>
        <p className="mt-3 flex items-center justify-center gap-1.5 text-center text-[11px] text-muted-foreground" dir={dir}>
          <ShieldCheck className="h-3 w-3" />
          {t.upload.trustNote}
        </p>
      </div>

      {/* Trust badges row */}
      <div className="mx-auto max-w-2xl px-4 pb-10" dir={dir}>
        <div className="flex items-stretch justify-between gap-2 rounded-2xl border border-border bg-card p-4 shadow-card">
          <TrustBadge icon={Clock} title={t.upload.trust.fast} sub={t.upload.trustSub.fast} />
          <ChevronRight className="my-auto h-4 w-4 shrink-0 text-muted-foreground rtl:rotate-180" />
          <TrustBadge icon={ShieldCheck} title={t.upload.trust.safe} sub={t.upload.trustSub.safe} />
          <ChevronRight className="my-auto h-4 w-4 shrink-0 text-muted-foreground rtl:rotate-180" />
          <TrustBadge icon={Check} title={t.upload.trust.trusted} sub={t.upload.trustSub.trusted} />
        </div>
      </div>
    </div>
  );
}

function TrustBadge({ icon: Icon, title, sub }: { icon: typeof Clock; title: string; sub: string }) {
  return (
    <div className="flex flex-1 flex-col items-center gap-1 text-center">
      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Icon className="h-4 w-4" />
      </div>
      <p className="text-[11px] font-bold text-foreground">{title}</p>
      <p className="text-[9px] leading-tight text-muted-foreground">{sub}</p>
    </div>
  );
}

