import { createFileRoute, Link } from "@tanstack/react-router";
import { Check } from "lucide-react";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { Logo } from "@/components/Logo";
import { useLang } from "@/i18n/LanguageProvider";

type Search = { id?: string };

export const Route = createFileRoute("/success")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    id: typeof s.id === "string" ? s.id : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Submitted — AIB" },
      { name: "description", content: "Your insurance documents were submitted successfully." },
    ],
  }),
  component: SuccessPage,
});

function SuccessPage() {
  const { t } = useLang();
  const { id } = Route.useSearch();

  return (
    <div className="min-h-screen bg-background animate-fade-in">
      <header className="px-4 pt-5">
        <div className="mx-auto flex max-w-2xl items-center justify-between">
          <Logo size={40} />
          <LanguageSwitcher />
        </div>
      </header>
      <main className="mx-auto flex max-w-2xl flex-col items-center px-4 pt-20 text-center">
        <div className="flex h-24 w-24 animate-scale-in items-center justify-center rounded-full bg-success/10 ring-8 ring-success/5">
          <Check className="h-12 w-12 text-success" strokeWidth={3} />
        </div>
        <h1 className="mt-8 text-2xl font-bold text-foreground sm:text-3xl">{t.success.title}</h1>
        <p className="mt-3 max-w-md text-base text-muted-foreground">{t.success.subtitle}</p>

        {id && (
          <div className="mt-6 inline-flex items-center gap-2 rounded-full bg-primary-soft px-4 py-2 text-sm font-semibold text-primary">
            <span>{t.success.requestId}:</span>
            <span className="font-mono">{id}</span>
          </div>
        )}

        <div className="mt-10 flex justify-center">
          <Link
            to="/"
            className="inline-flex h-12 items-center justify-center rounded-2xl bg-primary px-8 text-sm font-semibold text-primary-foreground shadow-soft transition hover:bg-primary/90 active:scale-[0.98]"
          >
            {t.success.back}
          </Link>
        </div>
      </main>
    </div>
  );
}
