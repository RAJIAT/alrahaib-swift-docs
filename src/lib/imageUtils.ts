/**
 * File → data URL helpers used by the mock upload pipeline.
 * Images are downscaled to keep localStorage payloads small.
 */

const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.85;
const MAX_PDF_BYTES = 5 * 1024 * 1024;

export async function fileToStoredDataUrl(file: File): Promise<string> {
  if (file.type.startsWith("image/")) {
    try {
      return await downscaleImage(file);
    } catch {
      return await readAsDataUrl(file);
    }
  }
  if (file.type === "application/pdf") {
    if (file.size > MAX_PDF_BYTES) {
      // Store a tiny placeholder data URL so request still saves.
      return "data:application/pdf;base64,";
    }
    return await readAsDataUrl(file);
  }
  return await readAsDataUrl(file);
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result ?? ""));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

async function downscaleImage(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const { width, height } = fit(img.naturalWidth, img.naturalHeight, MAX_EDGE);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no ctx");
    ctx.drawImage(img, 0, 0, width, height);
    return canvas.toDataURL("image/jpeg", JPEG_QUALITY);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function fit(w: number, h: number, max: number) {
  if (w <= max && h <= max) return { width: w, height: h };
  const ratio = w > h ? max / w : max / h;
  return { width: Math.round(w * ratio), height: Math.round(h * ratio) };
}

export function isPdfDataUrl(url: string) {
  return url.startsWith("data:application/pdf");
}
