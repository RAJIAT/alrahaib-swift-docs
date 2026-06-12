/**
 * Safe UUID v4 generator.
 * - Uses crypto.randomUUID() when available (HTTPS / modern runtimes).
 * - Falls back to crypto.getRandomValues() (works on http:// in most browsers).
 * - Last-resort timestamp + Math.random() fallback.
 */
export function safeUUID(): string {
  const g = (typeof globalThis !== "undefined" ? globalThis : {}) as {
    crypto?: { randomUUID?: () => string; getRandomValues?: (a: Uint8Array) => Uint8Array };
  };
  const c = g.crypto;
  if (c && typeof c.randomUUID === "function") {
    try { return c.randomUUID(); } catch { /* fall through */ }
  }
  if (c && typeof c.getRandomValues === "function") {
    try {
      const b = new Uint8Array(16);
      c.getRandomValues(b);
      b[6] = (b[6] & 0x0f) | 0x40;
      b[8] = (b[8] & 0x3f) | 0x80;
      const h = Array.from(b, (x) => x.toString(16).padStart(2, "0"));
      return `${h.slice(0, 4).join("")}-${h.slice(4, 6).join("")}-${h.slice(6, 8).join("")}-${h.slice(8, 10).join("")}-${h.slice(10, 16).join("")}`;
    } catch { /* fall through */ }
  }
  const rnd = () => Math.random().toString(16).slice(2).padStart(12, "0");
  return `${Date.now().toString(16).padStart(12, "0").slice(-12)}-${rnd().slice(0, 4)}-4${rnd().slice(0, 3)}-${((Math.random() * 4) | 8).toString(16)}${rnd().slice(0, 3)}-${rnd()}`;
}