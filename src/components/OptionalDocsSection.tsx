import { Car, ChevronDown, FileText, FolderOpen, Home, Plus } from "lucide-react";
import { useState } from "react";
import { DocumentRow } from "@/components/DocumentRow";
import { useLang } from "@/i18n/LanguageProvider";

type Props = {
  vehicleMedia: File[];
  setVehicleMedia: (f: File[]) => void;
  ownership: File[];
  setOwnership: (f: File[]) => void;
  contract: File[];
  setContract: (f: File[]) => void;
  other: File[];
  setOther: (f: File[]) => void;
};

type Slot = { id: string; files: File[] };

export function OptionalDocsSection({
  vehicleMedia,
  setVehicleMedia,
  ownership,
  setOwnership,
  contract,
  setContract,
  other,
  setOther,
}: Props) {
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  const [extraSlots, setExtraSlots] = useState<Slot[]>([]);

  const updateExtra = (id: string, files: File[]) => {
    setExtraSlots((prev) => prev.map((s) => (s.id === id ? { ...s, files } : s)));
    // Sync flattened files into `other`
    const flat = extraSlots.map((s) => (s.id === id ? files : s.files)).flat();
    setOther([...flat]);
  };

  const removeExtra = (id: string) => {
    const next = extraSlots.filter((s) => s.id !== id);
    setExtraSlots(next);
    setOther(next.flatMap((s) => s.files));
  };

  const addExtra = () => {
    setExtraSlots((prev) => [...prev, { id: `extra-${Date.now()}`, files: [] }]);
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-3 rounded-2xl border-2 border-dashed border-primary/40 bg-primary-soft/30 p-4 text-start transition hover:border-primary hover:bg-primary-soft/50 active:scale-[0.99]"
      >
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <Plus className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">{t.upload.optionalSection.openLabel}</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">{t.upload.optionalSection.hint}</p>
        </div>
        <ChevronDown className="h-4 w-4 text-muted-foreground" />
      </button>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between px-1">
        <h2 className="flex items-center gap-2 text-sm font-bold text-foreground">
          <span className="h-2 w-2 rounded-full bg-primary" />
          {t.upload.optionalSection.title}
        </h2>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-[11px] font-semibold text-muted-foreground hover:text-foreground"
        >
          ▲
        </button>
      </div>

      <DocumentRow
        icon={Car}
        label={t.upload.cards.vehiclePhotos}
        files={vehicleMedia}
        onChange={setVehicleMedia}
        onRemoveRow={() => setVehicleMedia([])}
        allowVideo
      />
      <DocumentRow
        icon={Home}
        label={t.upload.optionalSection.ownership}
        files={ownership}
        onChange={setOwnership}
        onRemoveRow={() => setOwnership([])}
      />
      <DocumentRow
        icon={FileText}
        label={t.upload.optionalSection.contract}
        files={contract}
        onChange={setContract}
        onRemoveRow={() => setContract([])}
        acceptAny
      />

      {extraSlots.map((slot) => (
        <DocumentRow
          key={slot.id}
          icon={FolderOpen}
          label={t.upload.optionalSection.otherDoc}
          files={slot.files}
          onChange={(f) => updateExtra(slot.id, f)}
          onRemoveRow={() => removeExtra(slot.id)}
          acceptAny
        />
      ))}

      <button
        type="button"
        onClick={addExtra}
        className="flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-primary/40 bg-primary-soft/20 p-3 text-sm font-semibold text-primary transition hover:bg-primary-soft/40 active:scale-[0.99]"
      >
        <Plus className="h-4 w-4" />
        {t.upload.optionalSection.addAnother}
      </button>
    </div>
  );
}
