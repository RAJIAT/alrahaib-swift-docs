/**
 * Prepare a File for upload to the backend.
 *
 * Why: phone cameras (especially iPhone) often produce 8-12 MB HEIC / large
 * JPEG photos. Many backends reject HEIC entirely and large files easily
 * fail on slow mobile connections. We downscale + re-encode every image to
 * a compact JPEG before sending. Non-image files pass through unchanged.
 */

const MAX_EDGE = 1800;
const JPEG_QUALITY = 0.82;

export async function prepareForUpload(file: File): Promise<File> {
  // Skip videos and other non-image files.
  if (!file.type.startsWith("image/") && !/\.(jpe?g|png|heic|heif|webp)$/i.test(file.name)) {
    return file;
  }
  // HEIC/HEIF cannot be decoded by a regular <img> tag in most browsers, but
  // iOS Safari can. Try the canvas path; if it fails, fall back to the raw file
  // so the backend at least gets *something*.
  try {
    return await downscaleToJpeg(file);
  } catch (err) {
    console.warn("image prep failed, using original file", err);
    return file;
  }
}

async function downscaleToJpeg(file: File): Promise<File> {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const { width, height } = fit(img.naturalWidth, img.naturalHeight, MAX_EDGE);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    ctx.drawImage(img, 0, 0, width, height);
    const blob: Blob = await new Promise((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("toBlob returned null"))),
        "image/jpeg",
        JPEG_QUALITY,
      );
    });
    const baseName = file.name.replace(/\.(heic|heif|png|webp|jpe?g)$/i, "") || "image";
    return new File([blob], `${baseName}.jpg`, { type: "image/jpeg" });
  } finally {
    URL.revokeObjectURL(url);
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image decode failed"));
    img.src = src;
  });
}

function fit(w: number, h: number, max: number) {
  if (w <= max && h <= max) return { width: w, height: h };
  const ratio = w > h ? max / w : max / h;
  return { width: Math.round(w * ratio), height: Math.round(h * ratio) };
}
