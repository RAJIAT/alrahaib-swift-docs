import { Camera, Check, Trash2, type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useLang } from "@/i18n/LanguageProvider";

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

const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const VIDEO_MAX_BYTES = 50 * 1024 * 1024;
const IMAGE_TYPES = ["image/jpeg", "image/jpg", "image/png", "application/pdf"];

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
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    const first = files[0];
    if (first && (first.type.startsWith("image/") || first.type.startsWith("video/"))) {
      const url = URL.createObjectURL(first);
      setPreviewUrl(url);
      return () => URL.revokeObjectURL(url);
    }
    setPreviewUrl(null);
  }, [files]);

  const accept = acceptAny
    ? "image/*,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv"
    : allowVideo
      ? "image/jpeg,image/jpg,image/png,application/pdf,video/*"
      : "image/jpeg,image/jpg,image/png,application/pdf";

  const isAllowed = (f: File) => {
    if (acceptAny) return !f.type.startsWith("video/") && f.size <= IMAGE_MAX_BYTES;
    if (IMAGE_TYPES.includes(f.type)) return f.size <= IMAGE_MAX_BYTES;
    if (allowVideo && f.type.startsWith("video/")) return f.size <= VIDEO_MAX_BYTES;
    return false;
  };

  const handle = (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (!list.length) return;
    const valid: File[] = [];
    let rejected = 0;
    for (const f of list) {
      if (isAllowed(f)) valid.push(f);
      else rejected += 1;
    }
    if (rejected > 0) toast.error(t.upload.errors.someRejected(rejected));
    if (!valid.length) return;
    onChange(multiple ? [...files, ...valid] : [valid[0]]);
  };

  const hasFile = files.length > 0;

  return (
    <div
      className={`flex items-center gap-3 rounded-2xl border bg-card p-3 shadow-card transition-all ${
        hasFile ? "border-success/40" : "border-border"
      }`}
    >
      <input ref={inputRef} type="file" multiple={multiple} accept={accept} className="hidden" onChange={handle} />

      {/* Preview / icon */}
      <div className="relative flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-primary-soft/50">
        {previewUrl ? (
          <img src={previewUrl} alt={label} className="h-full w-full object-cover" />
        ) : (
          <Icon className="h-6 w-6 text-primary" />
        )}
        {hasFile && (
          <div className="absolute -bottom-0.5 -end-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-success text-background ring-2 ring-card">
            <Check className="h-3 w-3" />
          </div>
        )}
      </div>

      {/* Label + status */}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-foreground">{label}</p>
        {hasFile ? (
          <p className="text-[11px] font-medium text-success">
            {files.length > 1 ? `${files.length} ${t.upload.uploaded}` : t.upload.uploaded}
          </p>
        ) : required ? (
          <p className="text-[11px] font-semibold text-destructive">{t.upload.required}</p>
        ) : (
          <p className="text-[11px] text-muted-foreground">{t.upload.optional}</p>
        )}
      </div>

      {/* Camera button */}
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        aria-label={t.upload.capture}
        className="flex h-14 w-16 shrink-0 flex-col items-center justify-center gap-0.5 rounded-xl bg-success/10 text-success transition active:scale-95 hover:bg-success/15"
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
  );
}
