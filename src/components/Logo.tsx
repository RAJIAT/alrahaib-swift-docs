import logoAsset from "@/assets/al-diplomacy-logo.png.asset.json";

export function Logo({ size = 44 }: { size?: number }) {
  return (
    <img
      src={logoAsset.url}
      alt="Al Diplomacy Insurance Services LLC"
      style={{ height: size, width: "auto" }}
      className="object-contain"
    />
  );
}
