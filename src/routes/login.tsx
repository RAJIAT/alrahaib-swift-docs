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
    setLoading(true);
    try {
      const u = await login(email, password);
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
              required
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
              required
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
      </main>
    </div>
  );
}
