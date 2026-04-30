import { Camera, FileText, Plus, Video, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useLang } from "@/i18n/LanguageProvider";

type Props = {
  label: string;
  /** Helper text shown under the title (e.g. "Upload front and back"). */
  hint?: string;
  files: File[];
  onChange: (files: File[]) => void;
  max?: number;
  /** Minimum required files (used for the counter, e.g. 0/2). */
  min?: number;
  optional?: boolean;
  /** Allow video files alongside images/PDF. Bumps max size to 50MB. */
  allowVideo?: boolean;
  /** Allow any file type EXCEPT video (images, PDF, Office docs, etc.). */
  acceptAny?: boolean;
};

const IMAGE_MAX_BYTES = 5 * 1024 * 1024; // 5MB for images / PDF / docs
const VIDEO_MAX_BYTES = 50 * 1024 * 1024; // 50MB for video
const IMAGE_TYPES = ["image/jpeg", "image/jpg", "image/png", "application/pdf"];

export function MultiUploadCard({
  label,
  hint,
  files,
  onChange,
  max = 6,
  min = 0,
  optional,
  allowVideo,
  acceptAny,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { t } = useLang();
  const [previews, setPreviews] = useState<string[]>([]);

  useEffect(() => {
    const urls = files.map((f) =>
      f.type.startsWith("image/") || f.type.startsWith("video/")
        ? URL.createObjectURL(f)
        : "",
    );
    setPreviews(urls);
    return () => {
      urls.forEach((u) => u && URL.revokeObjectURL(u));
    };
  }, [files]);

  const open = () => inputRef.current?.click();

  const isAllowed = (f: File) => {
    if (IMAGE_TYPES.includes(f.type)) return f.size <= IMAGE_MAX_BYTES;
    if (allowVideo && f.type.startsWith("video/")) return f.size <= VIDEO_MAX_BYTES;
    return false;
  };

  const handle = (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (list.length === 0) return;

    const valid: File[] = [];
    let rejected = 0;
    for (const f of list) {
      if (!isAllowed(f)) { rejected += 1; continue; }
      valid.push(f);
    }
    if (rejected > 0) toast.error(t.upload.errors.someRejected(rejected));
    if (valid.length === 0) return;

    const room = Math.max(0, max - files.length);
    onChange([...files, ...valid.slice(0, room)]);
  };

  const remove = (idx: number) => {
    const next = files.slice();
    next.splice(idx, 1);
    onChange(next);
  };

  const canAddMore = files.length < max;
  const acceptAttr = allowVideo
    ? "image/jpeg,image/jpg,image/png,application/pdf,video/*"
    : "image/jpeg,image/jpg,image/png,application/pdf";
  const formatHint = allowVideo
    ? "JPG · PNG · PDF · MP4 / MOV (≤ 50MB)"
    : "JPG · PNG · PDF · ≤ 2MB";
  const counterTotal = Math.max(max, min);
  const counterCurrent = files.length;
  const showCounter = files.length > 0 || min > 0;

  return (
    <div
      className={`relative overflow-hidden rounded-2xl border bg-card shadow-card transition-all ${
        files.length > 0 ? "border-primary/40" : "border-border"
      }`}
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={acceptAttr}
        className="hidden"
        onChange={handle}
      />
      <div className="flex items-start justify-between gap-2 px-4 pt-4">
        <div className="min-w-0">
          <h3 className="flex items-center gap-1.5 text-base font-semibold text-foreground">
            {label}
            {optional && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                {t.upload.optional}
              </span>
            )}
          </h3>
          {hint && (
            <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{hint}</p>
          )}
        </div>
        {showCounter && (
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
              counterCurrent >= min
                ? "bg-success/10 text-success"
                : "bg-muted text-muted-foreground"
            }`}
          >
            {counterCurrent}/{counterTotal}
          </span>
        )}
      </div>

      {files.length === 0 ? (
        <button
          type="button"
          onClick={open}
          className="m-4 flex aspect-[4/3] w-[calc(100%-2rem)] flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-border bg-primary-soft/40 text-primary transition-all hover:border-primary hover:bg-primary-soft active:scale-[0.99]"
        >
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
            {allowVideo ? <Video className="h-7 w-7" /> : <Camera className="h-7 w-7" />}
          </div>
          <span className="text-sm font-semibold">
            {allowVideo ? t.upload.captureMedia : t.upload.capture}
          </span>
          <span className="text-[10px] font-medium text-muted-foreground">{formatHint}</span>
        </button>
      ) : (
        <div className="grid grid-cols-3 gap-2 p-4">
          {files.map((f, idx) => {
            const isVideo = f.type.startsWith("video/");
            const isImage = f.type.startsWith("image/");
            return (
              <div key={idx} className="relative aspect-square overflow-hidden rounded-lg bg-muted">
                {isImage && previews[idx] ? (
                  <img src={previews[idx]} alt={`${label} ${idx + 1}`} className="h-full w-full object-cover" />
                ) : isVideo && previews[idx] ? (
                  <>
                    <video src={previews[idx]} className="h-full w-full object-cover" muted playsInline />
                    <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-foreground/30">
                      <Video className="h-6 w-6 text-background" />
                    </div>
                  </>
                ) : (
                  <div className="flex h-full w-full flex-col items-center justify-center gap-1 bg-primary-soft/40 p-1 text-primary">
                    <FileText className="h-6 w-6" />
                    <span className="max-w-full truncate text-[9px] font-semibold">{f.name}</span>
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => remove(idx)}
                  aria-label={t.upload.removePhoto}
                  className="absolute right-1 top-1 inline-flex h-6 w-6 items-center justify-center rounded-full bg-foreground/70 text-background transition-colors hover:bg-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}
          {canAddMore && (
            <button
              type="button"
              onClick={open}
              className="flex aspect-square flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-border bg-primary-soft/40 text-primary transition-colors hover:border-primary hover:bg-primary-soft"
            >
              <Plus className="h-5 w-5" />
              <span className="text-[10px] font-semibold">
                {allowVideo ? t.upload.addMedia : t.upload.addPhoto}
              </span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
