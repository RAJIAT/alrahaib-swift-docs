import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Loader2, Check } from "lucide-react";
import { toast } from "sonner";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { Logo } from "@/components/Logo";
import { UploadCard } from "@/components/UploadCard";
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
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const uploaded = [registration, license, emirates].filter(Boolean).length;
  const ready = uploaded === 3;
  const remaining = 3 - uploaded;

  const cards = useMemo(
    () => [
      { key: "registration", label: t.upload.cards.registration, file: registration, set: setRegistration },
      { key: "license", label: t.upload.cards.license, file: license, set: setLicense },
      { key: "emirates", label: t.upload.cards.emirates, file: emirates, set: setEmirates },
    ],
    [t, registration, license, emirates],
  );

  const onSubmit = async () => {
    if (!ready || !registration || !license || !emirates) return;
    setSubmitting(true);
    try {
      const { id } = await submitUpload({
        agentId: agent ?? "A123",
        images: { registration, license, emirates },
      });
      setDone(true);
      // Brief success flash before navigating.
      setTimeout(() => navigate({ to: "/success", search: { id } }), 600);
    } catch {
      toast.error("Upload failed. Please try again.");
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background pb-32 animate-fade-in">
      <header className="px-4 pt-5">
        <div className="mx-auto flex max-w-2xl items-center justify-between">
          <LanguageSwitcher />
          <div className="text-xs text-muted-foreground">
            {agent ? `Agent: ${agent}` : ""}
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
        </div>

        <section className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3" dir={dir}>
          {cards.map((c) => (
            <UploadCard key={c.key} label={c.label} file={c.file} onChange={c.set} />
          ))}
        </section>

        <p className="mt-5 text-center text-sm font-medium text-muted-foreground">
          {ready ? t.upload.allDone : t.upload.remaining(remaining)}
        </p>
      </main>

      {/* Sticky CTA */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-surface/80">
        <div className="mx-auto max-w-2xl">
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
    </div>
  );
}
