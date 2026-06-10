/**
 * Compatibility shim — re-exports the Branch type and a helper that detects
 * Directus asset URLs. Phase 3b entities (branches/agents) no longer depend
 * on demoStore via this shim.
 */

export type DxBranch = {
  id: number;
  name: string;
  code: string;
  address?: string;
  phone?: string;
  is_active?: boolean;
};

export function isDirectusAssetUrl(url: string): boolean {
  if (!url) return false;
  const base = (import.meta.env.VITE_DIRECTUS_URL as string | undefined) ?? "";
  if (!base) return false;
  try {
    return url.startsWith(base.replace(/\/+$/, "") + "/assets/");
  } catch {
    return false;
  }
}
