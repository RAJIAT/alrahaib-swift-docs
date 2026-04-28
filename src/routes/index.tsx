import { createFileRoute, Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Loader2, Check, LogIn, ShieldCheck, User, Zap } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { Logo } from "@/components/Logo";
import { UploadCard } from "@/components/UploadCard";
import { MultiUploadCard } from "@/components/MultiUploadCard";
import { useLang } from "@/i18n/LanguageProvider";
import { submitUpload } from "@/services/api";

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

  const [registration, setRegistration] = useState<File | null>(null);
  const [license, setLicense] = useState<File | null>(null);
  const [emirates, setEmirates] = useState<File | null>(null);
  const [inspection, setInspection] = useState<File | null>(null);
  const [vehiclePhotos, setVehiclePhotos] = useState<File[]>([]);
  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [errors, setErrors] = useState<{ name?: string; email?: string }>({});
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const uploaded = [registration, license, emirates].filter(Boolean).length;
  const docsReady = uploaded === 3;
  const remaining = 3 - uploaded;

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
      }),
    [t],
  );

  const kycValid = kycSchema.safeParse({ customerName, customerEmail }).success;
  const ready = docsReady && kycValid;

  const cards = useMemo(
    () => [
      { key: "registration", label: t.upload.cards.registration, file: registration, set: setRegistration },
      { key: "license", label: t.upload.cards.license, file: license, set: setLicense },
      { key: "emirates", label: t.upload.cards.emirates, file: emirates, set: setEmirates },
    ],
    [t, registration, license, emirates],
  );

  const onSubmit = async () => {
    const parsed = kycSchema.safeParse({ customerName, customerEmail });
    if (!parsed.success) {
      const fieldErrors: { name?: string; email?: string } = {};
      for (const issue of parsed.error.issues) {
        if (issue.path[0] === "customerName") fieldErrors.name = issue.message;
        if (issue.path[0] === "customerEmail") fieldErrors.email = issue.message;
      }
      setErrors(fieldErrors);
      return;
    }
    setErrors({});
    if (!docsReady || !registration || !license || !emirates) return;
    setSubmitting(true);
    try {
      const { id } = await submitUpload({
        agentId: agent ?? "A123",
        customerName: parsed.data.customerName,
        customerEmail: parsed.data.customerEmail,
        images: { registration, license, emirates },
        optional: { inspection, vehiclePhotos },
      });
      setDone(true);
      setTimeout(() => navigate({ to: "/success", search: { id } }), 600);
    } catch {
      toast.error("Upload failed. Please try again.");
      setSubmitting(false);
    }
  };

  return (
    <div className="bg-background animate-fade-in">
      <header className="px-4 pt-5">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-2">
          <LanguageSwitcher />
          <div className="flex items-center gap-3">
            {agent && (
              <span className="text-xs text-muted-foreground">{`Agent: ${agent}`}</span>
            )}
            <Link
              to="/login"
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-foreground transition hover:bg-muted"
            >
              <LogIn className="h-3.5 w-3.5" />
              {t.auth.title}
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 pt-6">
        <div className="flex flex-col items-center text-center">
          <Logo size={56} />
          <h1 className="mt-5 text-2xl font-bold leading-tight text-foreground sm:text-3xl">
            {t.upload.title}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground sm:text-base">
            {t.upload.subtitle}
          </p>

          {/* Trust + value prop (moved from footer) */}
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
        <section className="mt-8 rounded-2xl border border-border bg-card p-5 shadow-card" dir={dir}>
          <div className="mb-4 flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary">
              <User className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-foreground">{t.upload.kyc.title}</h2>
              <p className="text-xs text-muted-foreground">{t.upload.kyc.subtitle}</p>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
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
          </div>
        </section>

        <section className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3" dir={dir}>
          {cards.map((c) => (
            <UploadCard key={c.key} label={c.label} file={c.file} onChange={c.set} />
          ))}
        </section>

        <p className="mt-5 text-center text-sm font-medium text-muted-foreground">
          {docsReady ? t.upload.allDone : t.upload.remaining(remaining)}
        </p>

        {/* Optional uploads */}
        <section className="mt-6 grid gap-4 sm:grid-cols-2" dir={dir}>
          <UploadCard
            label={t.upload.cards.inspection}
            file={inspection}
            onChange={setInspection}
            optional
          />
          <MultiUploadCard
            label={t.upload.cards.vehiclePhotos}
            files={vehiclePhotos}
            onChange={setVehiclePhotos}
            optional
          />
        </section>
      </main>

      <div className="mx-auto mt-8 max-w-2xl px-4 pb-8">
        <button
          disabled={!ready || submitting}
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
            t.upload.submit
          )}
        </button>
      </div>
    </div>
  );
}
