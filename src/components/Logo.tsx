export function Logo({ size = 44 }: { size?: number }) {
  return (
    <div
      className="inline-flex items-center justify-center rounded-2xl bg-primary text-primary-foreground font-bold shadow-soft"
      style={{ width: size, height: size, fontSize: size * 0.42 }}
      aria-label="AIB"
    >
      AIB
    </div>
  );
}
