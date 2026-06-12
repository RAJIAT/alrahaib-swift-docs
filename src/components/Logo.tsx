export function Logo({ size = 44 }: { size?: number }) {
  return (
    <img
      src="/al-diplomacy-logo.png"
      alt="Al Diplomacy Insurance Services LLC"
      style={{ height: size, width: "auto" }}
      className="object-contain"
    />
  );
}
