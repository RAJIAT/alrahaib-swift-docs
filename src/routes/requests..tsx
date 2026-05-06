
function QuotesCard({
  req, user, onUpdated,
}: {
  req: InsuranceRequest;
  user: AuthUser | null;
  onUpdated: (r: InsuranceRequest) => void;
}) {
  const { lang } = useLang();
  const ar = lang === "ar";
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const inputRef = useState<HTMLInputElement | null>(null);

  if (!user) return null;

  const agents = listAgents();
  const meAgent = agents.find((a) => a.id === user.agentId);
  const myType = meAgent?.staffType;
  const isUW = myType === "underwriter";
  const isSales = myType === "sales";
  const isAdmin = user.role === "admin";
  const isSup = user.role === "supervisor" && user.branch === req.branch;

  const quotes = req.quotes ?? [];
  const fmt = (iso: string) =>
    new Date(iso).toLocaleString(ar ? "ar-AE" : "en-GB", { dateStyle: "short", timeStyle: "short" });

  const onFilesPicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (list.length) setFiles((prev) => [...prev, ...list]);
  };

  const upload = async () => {
    if (!files.length || busy) return;
    setBusy(true);
    try {
      const updated = await addQuotesToRequest(req.id, files);
      onUpdated(updated);
      setFiles([]);
      toast.success(ar ? "تم رفع عرض السعر" : "Quote uploaded");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (qid: string) => {
    setRemovingId(qid);
    try {
      const updated = await removeQuoteFromRequest(req.id, qid);
      onUpdated(updated);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setRemovingId(null);
    }
  };

  const shareLink = `${typeof window !== "undefined" ? window.location.origin : ""}/q/${encodeURIComponent(req.id)}`;
  const copyShareLink = async () => {
    try {
      await navigator.clipboard.writeText(shareLink);
      toast.success(ar ? "تم نسخ رابط المشاركة" : "Share link copied");
    } catch {
      window.prompt(ar ? "انسخ الرابط" : "Copy link", shareLink);
    }
  };
  const emailShareLink = () => {
    if (!req.customerEmail) return copyShareLink();
    const subject = encodeURIComponent(ar ? `عرض السعر — ${req.id}` : `Insurance quote — ${req.id}`);
    const body = encodeURIComponent(
      (ar
        ? `مرحباً ${req.customerName ?? ""}،\n\nيمكنك الاطلاع على عرض السعر من الرابط التالي:\n${shareLink}`
        : `Hello ${req.customerName ?? ""},\n\nYou can view your quote here:\n${shareLink}`),
    );
    window.location.href = `mailto:${encodeURIComponent(req.customerEmail)}?subject=${subject}&body=${body}`;
  };

  void inputRef;

  return (
    <section className="mt-6 rounded-2xl border border-border bg-card p-5 shadow-card">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-bold text-foreground">
          {ar ? "عروض الأسعار" : "Quotes"}
        </h3>
        <span className="text-[11px] text-muted-foreground">
          {quotes.length} {ar ? "ملف" : "file(s)"}
        </span>
      </div>

      {quotes.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {ar ? "لم يتم رفع أي عرض سعر بعد." : "No quotes uploaded yet."}
        </p>
      ) : (
        <ul className="space-y-2">
          {quotes.map((q) => {
            const canRemove = isAdmin || q.uploadedByUserId === user.id;
            return (
              <li key={q.id} className="flex items-center gap-3 rounded-xl border border-border bg-surface p-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary">
                  <FileText className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-foreground" title={q.name}>{q.name}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {q.size > 0 ? `${(q.size / 1024).toFixed(0)} KB · ` : ""}{q.type || "file"} · {q.uploadedByName} · {fmt(q.uploadedAt)}
                  </div>
                </div>
                <a
                  href={q.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-surface text-foreground transition hover:bg-muted"
                  aria-label="open"
                >
                  <ExternalLink className="h-4 w-4" />
                </a>
                {canRemove && (
                  <button
                    type="button"
                    disabled={removingId === q.id}
                    onClick={() => remove(q.id)}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-destructive transition hover:bg-destructive/10 disabled:opacity-50"
                    aria-label="remove"
                  >
                    {removingId === q.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* Underwriter / admin / supervisor can upload quotes */}
      {(isUW || isAdmin || isSup) && (
        <div className="mt-4 rounded-xl border border-dashed border-primary/40 bg-primary-soft/30 p-3">
          <label className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              type="file"
              multiple
              onChange={onFilesPicked}
              className="block w-full text-xs text-foreground file:me-3 file:rounded-lg file:border-0 file:bg-primary file:px-3 file:py-2 file:text-xs file:font-semibold file:text-primary-foreground"
            />
            {files.length > 0 && (
              <button
                onClick={upload}
                disabled={busy}
                className="inline-flex h-9 shrink-0 items-center gap-2 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground shadow-soft transition active:scale-95 disabled:opacity-50"
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                {ar ? `رفع (${files.length})` : `Upload (${files.length})`}
              </button>
            )}
          </label>
          <p className="mt-1 text-[10px] text-muted-foreground">
            {ar ? "PDF أو أي صيغة، يمكن رفع أكثر من ملف." : "PDF or any format, multiple files allowed."}
          </p>
        </div>
      )}

      {/* Sales / admin can share with customer once a quote exists */}
      {quotes.length > 0 && (isSales || isAdmin || isSup) && (
        <div className="mt-4 flex flex-col gap-2 rounded-xl border border-border bg-muted/30 p-3 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-foreground">
              {ar ? "مشاركة عرض السعر مع العميل" : "Share quote with customer"}
            </p>
            <p dir="ltr" className="mt-0.5 truncate text-[11px] text-muted-foreground" title={shareLink}>{shareLink}</p>
          </div>
          <button
            onClick={copyShareLink}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-xs font-semibold text-foreground shadow-soft transition hover:bg-muted active:scale-95"
          >
            <Copy className="h-3.5 w-3.5" />
            {ar ? "نسخ الرابط" : "Copy link"}
          </button>
          <button
            onClick={emailShareLink}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground shadow-soft transition active:scale-95"
          >
            <Mail className="h-3.5 w-3.5" />
            {ar ? "إرسال للعميل" : "Email customer"}
          </button>
        </div>
      )}
    </section>
  );
}
