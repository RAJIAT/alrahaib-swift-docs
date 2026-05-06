# Quote Workflow: Underwriter → Sales → Customer

Add the ability for an Underwriter to attach quotation files (PDF/any format, multiple) to a request, then let the Sales agent share those quotes with the customer through a public link with customer info shown at the top.

## What changes

### 1) Data model (`src/services/demoStore.ts`)
Extend `DemoRequest` with a new field:
```
quotes?: Array<{
  id: string;
  name: string;        // file name
  type: string;        // mime type
  size: number;
  url: string;         // data URL
  uploadedByUserId: string;
  uploadedByName: string;
  uploadedAt: string;
}>;
```
No migration needed (localStorage; field is optional).

### 2) API (`src/services/api.ts`)
Add two functions:
- `addQuotesToRequest(requestId, files: File[])` — only Underwriters can call. Converts files to data URLs (reuses `fileToDataUrl`), pushes them into `quotes`, writes a note ("Quote uploaded"), notifies the origin Sales agent + supervisor, and returns the updated request.
- `removeQuoteFromRequest(requestId, quoteId)` — only the uploader (or admin) can remove.

### 3) Request details page (`src/routes/requests.$id.tsx`)
Add a new **"Quotes / عروض الأسعار"** card under the existing sections:
- **Underwriters** see a `MultiUploadCard` (acceptAny, multi) + an "Upload quotes" button that calls `addQuotesToRequest`.
- **Sales / Admin / Supervisor** see the list of uploaded quotes (filename, uploader, date, open + download buttons).
- For Sales: a **"Share quote link with customer"** button that copies `/{origin}/q/{request.uuid}` to clipboard and optionally opens mailto with the link.

### 4) New public route `src/routes/q.$requestId.tsx`
Public, no-auth page (mirrors `r.$requestId.tsx` shape):
- Header with logo + language switcher.
- Customer card at top: "عرض السعر للسيد/ة {customerName}" + email/phone.
- Request reference (`#REQ-xxxx`), agent name, branch, date.
- List of quote files: each row shows filename, size, uploader/date, **Open** (opens data URL in new tab — works for PDFs/images) and **Download** buttons.
- Empty state if no quotes yet ("لم يتم رفع عرض السعر بعد").
- Uses `getRequest(requestId)` (already works without auth in demo store).

### 5) Notifications
On quote upload: notify the `originAgent` (Sales) — "الاندرايتر رفع عرض السعر للطلب #...".
On share (optional): no notification needed; Sales triggers it manually.

### 6) i18n (`src/i18n/translations.ts`)
Add keys under a new `quotes` namespace (AR + EN): `title`, `uploadHint`, `uploadCta`, `noneYet`, `uploadedBy`, `shareWithCustomer`, `linkCopied`, `customerPageTitle`, `openFile`, `download`, `forCustomer`.

## Technical notes
- Files stored as data URLs in localStorage, same pattern as existing attachments — keep individual files reasonably small (the `MultiUploadCard` already validates).
- The public quote page reads from the same demo store; in a real backend this would be a server-rendered route with a signed token, but for the current demo architecture using `request.uuid` in the URL is consistent with how `/r/$requestId` works today.
- Role gating done in the UI **and** in `addQuotesToRequest` (throws if caller is not an underwriter), matching the existing pattern in `deleteAgent`.

## Files touched
- `src/services/demoStore.ts` — add `quotes` field
- `src/services/api.ts` — add `addQuotesToRequest`, `removeQuoteFromRequest`
- `src/routes/requests.$id.tsx` — Quotes card + share button
- `src/routes/q.$requestId.tsx` — new public page
- `src/i18n/translations.ts` — new strings
