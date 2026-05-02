import { Camera, Check, Plus, Trash2, X, type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useLang } from "@/i18n/LanguageProvider";
import { prepareForUpload, validateUploadFile, isImageFile } from "@/lib/imagePrep";

type Props = {
  icon: LucideIcon;
  label: string;
  required?: boolean;
  files: File[];
  onChange: (files: File[]) => void;
  /** Show a trash button to remove this row entirely (optional sections only). */
  onRemoveRow?: () => void;
  multiple?: boolean;
  allowVideo?: boolean;
  acceptAny?: boolean;
};

export function DocumentRow({
  icon: Icon,
  label,
  required,
  files,
  onChange,
  onRemoveRow,
  multiple = true,
  allowVideo,
  acceptAny,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { t } = useLang();
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);

  useEffect(() => {
    const urls = files.map((f) =>
      f.type.startsWith("image/") || f.type.startsWith("video/") ? URL.createObjectURL(f) : "",
    );
    setPreviewUrls(urls);
    return () => {
      urls.forEach((u) => u && URL.revokeObjectURL(u));
    };
  }, [files]);

  const accept = acceptAny
    ? "image/*,application/pdf,.heic,.heif,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv"
    : allowVideo
      ? "image/*,application/pdf,.heic,.heif,video/*"
      : "image/*,application/pdf,.heic,.heif";

  const handle = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (!list.length) return;

    const valid: File[] = [];
    let firstError: ReturnType<typeof validateUploadFile> | null = null;
    let rejected = 0;
    for (const raw of list) {
      const err = validateUploadFile(raw, { allowVideo, acceptAny });
      if (err) {
        if (!firstError) firstError = err;
        rejected += 1;
        continue;
      }
      let f = raw;
      if (isImageFile(raw) && !raw.type.startsWith("video/")) {
        try { f = await prepareForUpload(raw); } catch { f = raw; }
      }
      valid.push(f);
    }

    if (rejected > 0 && firstError) {
      const mb = (n: number) => (n / 1024 / 1024).toFixed(1);
      const maxMb = (n: number) => (n / 1024 / 1024).toFixed(0);
      switch (firstError.kind) {
        case "imageTooLarge":
          toast.error(t.upload.errors.imageTooLarge(mb(firstError.size), maxMb(firstError.max)));
          break;
        case "docTooLarge":
          toast.error(t.upload.errors.docTooLarge(mb(firstError.size), maxMb(firstError.max)));
          break;
        case "videoTooLarge":
          toast.error(t.upload.errors.videoTooLarge(mb(firstError.size), maxMb(firstError.max)));
          break;
        case "badType":
        default:
          toast.error(t.upload.errors.badType);
      }
      if (rejected > 1) toast.error(t.upload.errors.someRejected(rejected));
    }
    if (!valid.length) return;
    onChange(multiple ? [...files, ...valid] : [valid[0]]);
  };

  const removeAt = (idx: number) => {
    const next = files.filter((_, i) => i !== idx);
    onChange(next);
  };

  const hasFile = files.length > 0;

  return (
    <div
      className={`rounded-2xl border bg-card p-3 shadow-card transition-all ${
        hasFile ? "border-primary/40" : "border-border"
      }`}
    >
      <input ref={inputRef} type="file" multiple={multiple} accept={accept} className="hidden" onChange={handle} />

      <div className="flex items-center gap-3">
        {/* Icon / status */}
        <div className="relative flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-primary-soft/50">
          <Icon className="h-6 w-6 text-primary" />
          {hasFile && (
            <div className="absolute -bottom-0.5 -end-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-background ring-2 ring-card">
              <Check className="h-3 w-3" />
            </div>
          )}
        </div>

        {/* Label + status */}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-foreground">{label}</p>
          {hasFile ? (
            <p className="text-[11px] font-medium text-primary">
              {files.length > 1 ? t.upload.filesCount(files.length) : t.upload.uploaded}
            </p>
          ) : required ? (
            <p className="text-[11px] font-semibold text-destructive">{t.upload.required}</p>
          ) : (
            <p className="text-[11px] text-muted-foreground">{t.upload.optional}</p>
          )}
          {multiple && !hasFile && (
            <p className="mt-0.5 text-[10px] text-muted-foreground">{t.upload.multipleHint}</p>
          )}
        </div>

        {/* Camera button */}
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          aria-label={t.upload.capture}
          className="flex h-14 w-16 shrink-0 flex-col items-center justify-center gap-0.5 rounded-xl bg-primary/10 text-primary transition active:scale-95 hover:bg-primary/15"
        >
          <Camera className="h-5 w-5" />
          <span className="text-[9px] font-semibold leading-none">{t.upload.capture}</span>
        </button>

        {onRemoveRow && (
          <button
            type="button"
            onClick={onRemoveRow}
            aria-label={t.upload.removePhoto}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-destructive transition hover:bg-destructive/10 active:scale-95"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Thumbnails grid + add-more button (visible whenever files exist) */}
      {hasFile && (
        <div className="mt-3 flex flex-wrap gap-2 border-t border-border pt-3">
          {files.map((f, idx) => {
            const url = previewUrls[idx];
            const isImage = f.type.startsWith("image/") && url;
            const isVideo = f.type.startsWith("video/") && url;
            return (
              <div
                key={`${f.name}-${idx}`}
                className="group relative h-16 w-16 overflow-hidden rounded-lg border border-border bg-muted"
              >
                {isImage ? (
                  <img src={url} alt={f.name} className="h-full w-full object-cover" />
                ) : isVideo ? (
                  <video src={url} className="h-full w-full object-cover" muted />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-[9px] font-semibold text-muted-foreground">
                    PDF
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => removeAt(idx)}
                  aria-label={t.upload.removeFile}
                  className="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-destructive text-destructive-foreground shadow-md transition active:scale-90"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            );
          })}

          {multiple && (
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="flex h-16 w-16 shrink-0 flex-col items-center justify-center gap-0.5 rounded-lg border-2 border-dashed border-primary/40 bg-primary-soft/30 text-primary transition hover:border-primary hover:bg-primary-soft/50 active:scale-95"
            >
              <Plus className="h-4 w-4" />
              <span className="text-[8px] font-semibold leading-none">{t.upload.addMore}</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
