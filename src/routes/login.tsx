import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { Logo } from "@/components/Logo";
import { useLang } from "@/i18n/LanguageProvider";
import { login } from "@/services/api";

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

function LoginPage() {
  const { t } = useLang();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    // Read directly from the form fields too — autofill / very fast typing
    // can momentarily desync React state with the DOM value (race), causing
    // a spurious "Please fill out this field" or empty-credential submit.
    const form = e.currentTarget as HTMLFormElement;
    const fd = new FormData(form);
    const finalEmail = (fd.get("email")?.toString() ?? email).trim();
    const finalPassword = (fd.get("password")?.toString() ?? password).trim();
    if (!finalEmail || !finalPassword) {
      setError(t.auth.invalid);
      return;
    }
    setLoading(true);
    try {
      const u = await login(finalEmail, finalPassword);
      navigate({ to: u.role === "admin" || u.role === "supervisor" ? "/admin" : "/agent" });
    } catch {
      setError(t.auth.invalid);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="px-4 pt-5">
        <div className="mx-auto flex max-w-md items-center justify-between">
          <Link to="/" aria-label="Home"><Logo size={40} /></Link>
          <LanguageSwitcher />
        </div>
      </header>

      <main className="mx-auto flex max-w-md flex-col px-4 pt-12">
        <h1 className="text-2xl font-bold text-foreground text-center">{t.auth.title}</h1>
        <p className="mt-2 text-sm text-muted-foreground text-center">{t.auth.subtitle}</p>

        <form onSubmit={onSubmit} className="mt-8 space-y-4 rounded-2xl border border-border bg-card p-6 shadow-card">
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-foreground">{t.auth.email}</span>
            <input
              type="email"
              name="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-12 w-full rounded-xl border border-input bg-surface px-4 text-foreground outline-none ring-primary focus:ring-2"
              placeholder="agent@aib.com"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-foreground">{t.auth.password}</span>
            <input
              type="password"
              name="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-12 w-full rounded-xl border border-input bg-surface px-4 text-foreground outline-none ring-primary focus:ring-2"
              placeholder="••••••••"
            />
          </label>
          {error && <p className="text-sm font-medium text-destructive">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-primary-foreground shadow-soft transition disabled:opacity-50"
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            {t.auth.submit}
          </button>
        </form>

        <div className="mt-6 rounded-2xl border border-dashed border-border bg-card p-4">
          <p className="mb-2 text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            One-click demo login
          </p>
          <div className="grid grid-cols-3 gap-2">
            {(
              [
                { label: "Admin", email: "admin@demo.com" },
                { label: "Supervisor", email: "supervisor@demo.com" },
                { label: "Agent", email: "agent@demo.com" },
              ] as const
            ).map((q) => (
              <button
                key={q.email}
                type="button"
                disabled={loading}
                onClick={async () => {
                  setError(""); setLoading(true);
                  try {
                    const u = await login(q.email, "demo123");
                    navigate({ to: u.role === "agent" ? "/agent" : "/admin" });
                  } catch {
                    setError(t.auth.invalid);
                  } finally { setLoading(false); }
                }}
                className="h-10 rounded-xl border border-border bg-surface text-xs font-semibold text-foreground transition hover:bg-muted disabled:opacity-50"
              >
                {q.label}
              </button>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
