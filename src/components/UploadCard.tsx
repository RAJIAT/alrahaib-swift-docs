import { Camera, Check, RefreshCw, FileText } from "lucide-react";
import { useRef, useState } from "react";
import { useLang } from "@/i18n/LanguageProvider";

type Props = {
  label: string;
  file: File | null;
  onChange: (f: File | null) => void;
};

export function UploadCard({ label, file, onChange }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { t } = useLang();
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const open = () => inputRef.current?.click();
  const handle = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null;
    onChange(f);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(f ? URL.createObjectURL(f) : null);
  };

  return (
    <div
      className={`relative overflow-hidden rounded-2xl border bg-card shadow-card transition ${
        file ? "border-success/40" : "border-border"
      }`}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/jpg,image/png,image/webp,image/heic,image/heif,application/pdf"
        className="hidden"
        onChange={handle}
      />
      <div className="flex items-center justify-between px-4 pt-4">
        <h3 className="text-base font-semibold text-foreground">{label}</h3>
        {file && (
          <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-xs font-semibold text-success">
            <Check className="h-3.5 w-3.5" />
            {t.upload.uploaded}
          </span>
        )}
      </div>

      {previewUrl ? (
        <button
          type="button"
          onClick={open}
          className="group relative mx-4 mt-3 mb-4 block aspect-[4/3] w-[calc(100%-2rem)] overflow-hidden rounded-xl bg-muted"
        >
          <img src={previewUrl} alt={label} className="h-full w-full object-cover" />
          <div className="absolute inset-0 flex items-center justify-center bg-foreground/0 transition group-hover:bg-foreground/40">
            <span className="inline-flex items-center gap-2 rounded-full bg-surface/90 px-3 py-1.5 text-sm font-medium text-foreground opacity-0 transition group-hover:opacity-100">
              <RefreshCw className="h-4 w-4" />
              {t.upload.replace}
            </span>
          </div>
        </button>
      ) : (
        <button
          type="button"
          onClick={open}
          className="m-4 flex aspect-[4/3] w-[calc(100%-2rem)] flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-border bg-primary-soft/40 text-primary transition hover:border-primary hover:bg-primary-soft"
        >
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
            <Camera className="h-7 w-7" />
          </div>
          <span className="text-sm font-semibold">{t.upload.capture}</span>
        </button>
      )}
    </div>
  );
}
