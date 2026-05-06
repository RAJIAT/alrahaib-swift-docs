import { useEffect, useRef, useState } from "react";
import { Bell, Check } from "lucide-react";
import { Link } from "@tanstack/react-router";
import {
  getCurrentUser, listNotificationsFor, markAllNotificationsRead, markNotificationRead,
  subscribeNotifications, type AppNotification,
} from "@/services/api";
import { useLang } from "@/i18n/LanguageProvider";

export function NotificationBell() {
  const { t, dir } = useLang();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<AppNotification[]>([]);
  const ref = useRef<HTMLDivElement>(null);

  const refresh = () => {
    const me = getCurrentUser();
    if (!me) { setItems([]); return; }
    setItems(listNotificationsFor(me.id).slice(0, 25));
  };

  useEffect(() => {
    refresh();
    const off = subscribeNotifications(refresh);
    return () => off();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const unread = items.filter((n) => !n.read).length;
  const me = getCurrentUser();
  const align = dir === "rtl" ? "left-0" : "right-0";

  const onItem = (n: AppNotification) => {
    if (!n.read) markNotificationRead(n.id);
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={t.notifications.title}
        className="relative inline-flex h-10 w-10 items-center justify-center rounded-lg border border-border text-foreground hover:bg-muted"
      >
        <Bell className="h-5 w-5" />
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div className={`absolute ${align} top-12 z-50 w-80 max-w-[92vw] overflow-hidden rounded-2xl border border-border bg-card shadow-elevated`}>
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <span className="text-sm font-bold text-foreground">{t.notifications.title}</span>
            {items.length > 0 && me && (
              <button
                onClick={() => markAllNotificationsRead(me.id)}
                className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
              >
                <Check className="h-3.5 w-3.5" />
                {t.notifications.markAllRead}
              </button>
            )}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {items.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-muted-foreground">{t.notifications.empty}</div>
            ) : items.map((n) => {
              const body = (
                <div className={`flex flex-col gap-0.5 border-t border-border px-4 py-3 text-sm transition hover:bg-muted/40 ${!n.read ? "bg-primary/5" : ""}`}>
                  <div className="font-semibold text-foreground">{n.title}</div>
                  {n.body && <div className="text-xs text-muted-foreground">{n.body}</div>}
                  <div className="text-[10px] text-muted-foreground">
                    {new Date(n.createdAt).toLocaleString()}
                  </div>
                </div>
              );
              return n.link ? (
                <Link key={n.id} to={n.link} onClick={() => onItem(n)}>{body}</Link>
              ) : (
                <button key={n.id} onClick={() => onItem(n)} className="block w-full text-start">{body}</button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
