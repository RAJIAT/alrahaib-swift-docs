import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { Building2, LayoutDashboard, LogOut, Menu, ScrollText, Users, X } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { Logo } from "@/components/Logo";
import { NotificationBell } from "@/components/NotificationBell";

import { useLang } from "@/i18n/LanguageProvider";
import { canManageAgents, getCurrentUser, logout, refreshCurrentUser, type Role } from "@/services/api";

type NavItem = { to: string; label: string; icon: ReactNode };

export function DashboardShell({
  role,
  children,
  title,
}: {
  role: Role | Role[];
  children: ReactNode;
  title?: string;
}) {
  const { t, dir } = useLang();
  const navigate = useNavigate();
  // Defer reading localStorage until after mount to avoid SSR hydration mismatch.
  const [mounted, setMounted] = useState(false);
  const [user, setUser] = useState<ReturnType<typeof getCurrentUser>>(null);
  const [open, setOpen] = useState(false);
  const path = useRouterState({ select: (s) => s.location.pathname });

  const allowed = useMemo(() => (Array.isArray(role) ? role : [role]), [role]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Verify session against Directus and refresh cached profile.
      const fresh = await refreshCurrentUser().catch(() => null);
      if (cancelled) return;
      const u = fresh ?? getCurrentUser();
      setUser(u);
      setMounted(true);
      if (!u || !allowed.includes(u.role)) {
        navigate({ to: "/login" });
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { setOpen(false); }, [path]);

  const items: NavItem[] = useMemo(() => {
    if (!user) return [];
    if (user.role === "admin") {
      return [
        { to: "/admin", label: t.nav.dashboard, icon: <LayoutDashboard className="h-5 w-5" /> },
        { to: "/agents", label: t.admin.manageAgents, icon: <Users className="h-5 w-5" /> },
        { to: "/branches", label: t.admin.manageBranches, icon: <Building2 className="h-5 w-5" /> },
        { to: "/audit", label: t.admin.auditLog, icon: <ScrollText className="h-5 w-5" /> },
      ];
    }
    if (user.role === "supervisor") {
      return [
        { to: "/admin", label: t.nav.dashboard, icon: <LayoutDashboard className="h-5 w-5" /> },
        { to: "/agents", label: t.admin.manageAgents, icon: <Users className="h-5 w-5" /> },
      ];
    }
    return [
      { to: "/agent", label: t.nav.requests, icon: <LayoutDashboard className="h-5 w-5" /> },
    ];
  }, [user, t]);

  const onLogout = () => {
    logout();
    navigate({ to: "/login" });
  };

  if (!mounted || !user) return <div className="min-h-screen bg-background" />;

  const sideBorder = dir === "rtl" ? "border-l" : "border-r";
  // Suppress unused warning — kept for potential per-shell admin gating
  void canManageAgents;

  return (
    <div className="min-h-screen bg-background">
      <div className="flex min-h-screen">
        <aside className={`hidden lg:flex w-72 shrink-0 flex-col bg-sidebar p-5 ${sideBorder} border-border`}>
          <SidebarInner items={items} user={user} onLogout={onLogout} />
        </aside>

        {open && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <div className="absolute inset-0 bg-foreground/40" onClick={() => setOpen(false)} />
            <aside
              className={`absolute top-0 ${dir === "rtl" ? "right-0" : "left-0"} flex h-full w-72 shrink-0 flex-col bg-sidebar p-5 ${sideBorder} border-border`}
            >
              <SidebarInner items={items} user={user} onLogout={onLogout} />
            </aside>
          </div>
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-3 border-b border-border bg-surface/80 px-4 backdrop-blur lg:px-8">
            <div className="flex items-center gap-3">
              <button
                className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-border lg:hidden"
                onClick={() => setOpen(true)}
                aria-label="Open menu"
              >
                <Menu className="h-5 w-5" />
              </button>
              <h1 className="text-lg font-bold text-foreground">{title ?? t.nav.dashboard}</h1>
            </div>
            <LanguageSwitcher />
          </header>
          <main className="flex-1 px-4 py-6 lg:px-8 lg:py-8">{children}</main>
        </div>
      </div>
    </div>
  );
}

function SidebarInner({
  items,
  user,
  onLogout,
}: {
  items: NavItem[];
  user: { name: string; email: string; role: Role };
  onLogout: () => void;
}) {
  const { t } = useLang();
  const path = useRouterState({ select: (s) => s.location.pathname });

  return (
    <>
      <div className="mb-8 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Logo size={40} />
          <div>
            <div className="text-sm font-bold text-sidebar-foreground">DocFlow</div>
            <div className="text-xs text-muted-foreground capitalize">{user.role}</div>
          </div>
        </div>
        <button
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground lg:hidden"
          onClick={() => {/* drawer closes via path change */}}
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <nav className="flex-1 space-y-1">
        {items.map((it, i) => {
          const active = path === it.to;
          return (
            <Link
              key={i}
              to={it.to}
              className={`flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium transition ${
                active
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground hover:bg-sidebar-accent/60"
              }`}
            >
              {it.icon}
              {it.label}
            </Link>
          );
        })}
      </nav>

      <div className="mt-4 border-t border-sidebar-border pt-4">
        <div className="mb-3 px-2">
          <div className="truncate text-sm font-semibold text-sidebar-foreground">{user.name}</div>
          <div className="truncate text-xs text-muted-foreground">{user.email}</div>
        </div>
        <button
          onClick={onLogout}
          className="flex w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium text-destructive transition hover:bg-destructive/10"
        >
          <LogOut className="h-5 w-5" />
          {t.nav.logout}
        </button>
      </div>
    </>
  );
}
