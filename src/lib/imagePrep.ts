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

/** Upper limits enforced BEFORE any compression. */
export const RAW_IMAGE_MAX_BYTES = 25 * 1024 * 1024; // 25MB raw image (will be compressed)
export const DOC_MAX_BYTES = 10 * 1024 * 1024; // 10MB for PDF / Office
export const VIDEO_MAX_BYTES = 50 * 1024 * 1024; // 50MB for video

export const IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
];

export const DOC_MIME_TYPES = [
  "application/pdf",
];

export function isImageFile(f: File): boolean {
  return f.type.startsWith("image/") || /\.(jpe?g|png|heic|heif|webp)$/i.test(f.name);
}

export function isVideoFile(f: File): boolean {
  return f.type.startsWith("video/");
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Validate a file's size/type. Returns null if OK, or an error key + the
 * caller can format with formatFileSize() for user-facing messages.
 */
export type FileValidationError =
  | { kind: "imageTooLarge"; size: number; max: number }
  | { kind: "docTooLarge"; size: number; max: number }
  | { kind: "videoTooLarge"; size: number; max: number }
  | { kind: "badType" };

export function validateUploadFile(
  f: File,
  opts: { allowVideo?: boolean; allowDocs?: boolean; acceptAny?: boolean } = {},
): FileValidationError | null {
  const { allowVideo, allowDocs = true, acceptAny } = opts;
  if (isVideoFile(f)) {
    if (!allowVideo) return { kind: "badType" };
    if (f.size > VIDEO_MAX_BYTES) {
      return { kind: "videoTooLarge", size: f.size, max: VIDEO_MAX_BYTES };
    }
    return null;
  }
  if (isImageFile(f)) {
    if (f.size > RAW_IMAGE_MAX_BYTES) {
      return { kind: "imageTooLarge", size: f.size, max: RAW_IMAGE_MAX_BYTES };
    }
    return null;
  }
  // Non-image, non-video
  if (acceptAny || (allowDocs && DOC_MIME_TYPES.includes(f.type))) {
    if (f.size > DOC_MAX_BYTES) {
      return { kind: "docTooLarge", size: f.size, max: DOC_MAX_BYTES };
    }
    return null;
  }
  return { kind: "badType" };
}

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
    if (import.meta.env.DEV) console.warn("image prep failed, using original file", err);
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
