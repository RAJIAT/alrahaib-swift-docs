## Goal

One coherent fix pass for the Al Diplomacy request workflow so we stop patching the same flows piecemeal. Covers clipboard behavior on the HTTP portal, the share-with-customer modal, missing-note saves, sales-agent status controls, notification fan-out, supervisor /agents visibility, and generic error toasts. Backed by a single live-patch script.

## What to change

### 1. Copy link (no prompt fallback) — `src/routes/requests.$id.tsx`

The portal runs on `http://10.8.0.21` (insecure context), so `navigator.clipboard.writeText` rejects and the current code falls back to `window.prompt(...)`, which is the "field where the user has to copy manually" the user is complaining about. Replace with a hidden `<textarea>` + `document.execCommand('copy')` fallback in a shared helper used by both:

- `copyReuploadLink` (line 838) — notes section "Copy reupload link"
- `copyShareLink` (line 1420) — share-quote modal "Copy link"

On any failure show the real error in the toast (`toast.error(err.message)`), never a silent prompt.

### 2. Share Quote with Customer modal

Already wired (`shareOpen` state + WhatsApp/Email/Copy/Open buttons, lines 1622-1701). Verify and polish:

- WhatsApp uses `req.customerPhone` → `wa.me/{digits}` with prefilled message + quote link. Toast only when status flip succeeds, never "sent" wording.
- Email uses `req.customerEmail` → `mailto:` with subject/body. Toast: "Email client opened, send manually" (already present, keep both languages).
- Copy uses the new clipboard helper.
- Open opens `/q/:id` in a new tab.
- `markLinkSentBestEffort` only flips status after a channel is actually picked (already correct).
- Remove the "Send to Customer" duplicate phrasing on the underwriter side — underwriter never sees this card (gated by `isSales || isAdmin || isSup`), so confirm no leftover button outside the modal.

### 3. Sales-agent status controls — `src/routes/requests.$id.tsx` (lines 524-559)

The current 4-button grid is correct for sales agents (`canRunFinalActions` already includes them), but it's missing **Rejected** and the "Create Quote" label is misleading for sales (it just flips status to `processing`). Rework to a 6-button responsive grid with explicit Sales-friendly labels:

- Processing / قيد المعالجة → `processing`
- Payment link sent / تم إرسال رابط الدفع → `linkSent`
- Awaiting missing documents / بانتظار إكمال النواقص → `reupload` (mirrors the Missing-note flow)
- Request reupload / طلب إعادة رفع → `reupload` (same status; keep separate button only if labels diverge — otherwise collapse to one)
- Sold / تم البيع → `sold`
- Rejected / مرفوض → `rejected`

Add the missing `markRejected` / `markProcessing` translation keys in `src/i18n/translations.ts` (en + ar). Keep the same `setStatus(...)` handler — no business logic changes.

### 4. "Add missing" save failure — `src/services/directusRequests.ts` + `src/services/api.ts`

Root cause is one or both of:
- The note POST succeeds but the follow-up `dxSetRequestStatus(requestId, "reupload")` PATCH 403s for some role/branch combinations (Agent policy update only allows owners; sales agent is the owner so should pass, but supervisor/underwriter writing a missing note can fail). The `try/catch` swallows it, then the subsequent `dxGetRequest` may also fail for an underwriter who just removed themselves as agent.
- The frontend toast is a generic string, masking the real Directus message.

Fix:
- In `dxAddNote` (line 539), do not swallow the status-flip failure silently — log + rethrow only the note error; treat status-flip failure as soft (already soft) but include the underlying message in a `console.warn`.
- In `NotesSection.submit` (`requests.$id.tsx` line 805), replace the generic `tعذر حفظ الملاحظة` toast with `toast.error(err.message ?? generic)` so the Directus message surfaces (matches what `setStatus` already does).
- Defensive: after the note POST, refetch via `dxGetRequest`; if that returns null (e.g. underwriter lost read access mid-flow) fall back to a synthetic merge of `current` + the new note instead of throwing "Request not found after note add".

### 5. Notifications fan-out

Frontend never creates notifications; only the quote-upload Directus flow does. Extend the live-patch script to register flows for:
- `request_files.create` where `kind in (registration, license, emirates, inspection, vehicleMedia, missing_attachment, attachment)` → notify `request.agent` and `request.origin_agent` (customer-upload + missing-doc reupload).
- `requests.update` where `agent` changes → notify the new `agent` ("New request assigned: REQ-...").
- `request_notes.create` where `kind = 'missing'` → notify `request.agent` and `request.origin_agent`.
- Keep the existing quote-upload flow.

Each flow inserts into `notifications(recipient, kind, title, body, link)` with `link = /requests/{request_id}`. The bell already polls `notifications` filtered by `recipient = $CURRENT_USER`, so no client changes needed beyond confirming `NotificationBell` subscribes (it already does via `subscribeNotifications`).

### 6. Supervisor /agents page

The debug card, branch-tolerant filter, and "Add Sales Agent / Add Underwriter" labels are already in place. Verify the supervisor read policy on `directus_users` is present (added in an earlier patch). The live-patch script will re-assert it idempotently so a fresh server gets it without a separate run.

### 7. Generic error handling

Sweep `src/routes/requests.$id.tsx` and `src/services/api.ts` for `toast.error("...generic...")` next to a caught `e` and switch to `toast.error(e instanceof Error ? e.message : String(e))`. Same for "Not allowed" — surface the Directus body. Add a `safeMessage(e, fallback)` helper in `src/lib/utils.ts` to keep call sites tidy.

### 8. Live patch script — `scripts/directus-patch-workflow.ts` (new)

Single idempotent script that:
- Re-asserts Agent policy `request_notes.create` with `validation: author == $CURRENT_USER` and fields `request,text,kind,author,author_role`.
- Re-asserts Agent + Supervisor `notifications.create` (so flows running as the actor still succeed; flows run as the trigger user).
- Creates/updates the four notification flows listed above. Each flow is upserted by name (`lovable: customer_upload_notify`, `lovable: reassign_notify`, `lovable: missing_note_notify`, `lovable: quote_upload_notify` — keep existing).
- Re-asserts Supervisor read on `directus_users` filtered by branch.

Bootstrap (`scripts/directus-bootstrap.ts`) gets the same permission rows added so a fresh install is correct without the patch.

Run command (Node/tsx, Al Diplomacy):

```bash
DIRECTUS_URL=http://127.0.0.1:8055 \
DIRECTUS_ADMIN_TOKEN=<admin_token> \
npx tsx scripts/directus-patch-workflow.ts
```

## Files touched

- `src/routes/requests.$id.tsx` — clipboard helper, sales-agent status grid, real error toasts in NotesSection
- `src/i18n/translations.ts` — `markRejected`, `markProcessing` (en + ar)
- `src/services/directusRequests.ts` — `dxAddNote` resilience + better errors
- `src/services/api.ts` — surface Directus error in `addRequestNote`
- `src/lib/utils.ts` — `safeMessage(e, fallback)` helper
- `scripts/directus-patch-workflow.ts` — new live-patch script (flows + permissions)
- `scripts/directus-bootstrap.ts` — fold the same permissions in for fresh installs

## Out of scope

- SMTP / real email sending (we still rely on `mailto:` because the server has no SMTP wired).
- Removing the existing public-quote patch script (still required for `/q/:id`).
- UI redesign of the request details page beyond the status-button grid.
