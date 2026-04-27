import logoUrl from "@/assets/logo.webp";

export function Logo({ size = 44 }: { size?: number }) {
  return (
    <img
      src={logoUrl}
      alt="Al Raha Insurance Broker"
      style={{ height: size, width: "auto" }}
      className="object-contain"
    />
  );
}
