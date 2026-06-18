import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Canonical public origin used for customer-facing shareable links
 * (reupload `/r/:id` and quote `/q/:id`). Always prefer the production
 * domain so links pasted into WhatsApp/email work from any device — never
 * leak internal IPs like 10.8.0.21 or preview/sandbox hostnames.
 *
 * Override with `VITE_PUBLIC_APP_URL` only when it points at an https
 * domain (not a raw IP). Falls back to `https://app.al-dis.com`.
 */
export function getPublicAppOrigin(): string {
  const fallback = "https://app.al-dis.com";
  const raw =
    (typeof import.meta !== "undefined" &&
      (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.VITE_PUBLIC_APP_URL) ||
    "";
  const cleaned = (raw || "").trim().replace(/\/+$/, "");
  // Reject empty, http://, raw IPs, and anything that's not the public domain.
  if (!cleaned) return fallback;
  if (!/^https:\/\//i.test(cleaned)) return fallback;
  if (/\d+\.\d+\.\d+\.\d+/.test(cleaned)) return fallback;
  return cleaned;
}

/** Best-effort extraction of an error's display message. */
export function safeMessage(e: unknown, fallback = "Unexpected error"): string {
  if (e instanceof Error && e.message) return e.message;
  if (typeof e === "string" && e) return e;
  try {
    const s = JSON.stringify(e);
    if (s && s !== "{}") return s;
  } catch { /* ignore */ }
  return fallback;
}

/**
 * Copy `text` to the clipboard. Works on insecure (http://) origins by
 * falling back to a hidden textarea + `document.execCommand('copy')`.
 * Throws on failure so callers can surface a real error toast.
 */
export async function copyToClipboard(text: string): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      /* fall through to execCommand */
    }
  }
  if (typeof document === "undefined") throw new Error("Clipboard not available");
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.top = "-1000px";
  ta.style.left = "0";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  let ok = false;
  try { ok = document.execCommand("copy"); } catch { ok = false; }
  document.body.removeChild(ta);
  if (!ok) throw new Error("Copy command rejected by browser");
}
