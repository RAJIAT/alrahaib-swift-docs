import type { ReactNode } from "react";

export function EmptyState({
  icon,
  title,
  subtitle,
  action,
}: {
  icon: ReactNode;
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card/50 px-6 py-14 text-center animate-fade-in">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary-soft text-primary">
        {icon}
      </div>
      <h3 className="text-base font-bold text-foreground">{title}</h3>
      {subtitle && <p className="mt-1.5 max-w-sm text-sm text-muted-foreground">{subtitle}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
