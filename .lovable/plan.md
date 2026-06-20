# Al Diplomacy — Client Feedback Implementation Plan

This plan covers the corporate upload flow and all 6 items from the uploaded feedback document, plus the request-history polish.

---

## 1. Corporate vs Individual upload flow (customer side)

**Customer link page (`src/routes/index.tsx`)**
- Add a first step: client type selector — **Individual / Personal Client** vs **Corporate Client**.
- Until a type is chosen, hide the documents section; the KYC card stays at the top.
- If **Individual** → render existing required rows unchanged (Registration, License, Emirates ID) + existing optional section.
- If **Corporate** → swap required rows to:
  - Trade License
  - VAT Certificate
  - Owners Emirates ID
  - (keep the same optional section: vehicle media / inspection / attachments)
- Validation, progress count ("X remaining"), and submit gating switch based on type.

**Submission**
- `submitUpload` (`src/services/api.ts`) gains `clientType: "individual" | "corporate"` and accepts the new file slots (`tradeLicense`, `vatCertificate`, `ownersEmiratesId`).
- Files are uploaded with proper `doc_type` labels so the request-details and ZIP can identify them.

**Reupload page (`src/routes/r.$requestId.tsx`)**
- Reads `client_type` from the request and renders the matching field set when the staff requests missing docs.

---

## 2. Directus changes

**Schema (via new patch script `scripts/directus-patch-client-type.ts`)**
- `requests.client_type` — string, default `individual`, allowed `individual` | `corporate`.
- `request_files.doc_type` — extend allowed values: `trade_license`, `vat_certificate`, `owners_emirates_id` (in addition to existing registration/license/emirates/vehicle/inspection/attachment).

**Permissions (`scripts/directus-permissions.json` + patch script)**
- Public role: allow create on `requests.client_type` and on `request_files` for the new `doc_type` values (matches existing public upload flow).
- Authenticated roles (admin / supervisor / agent / underwriter): read `client_type`, read all new file rows (extends existing `request_files` read scope).

**Bootstrap**
- `scripts/directus-bootstrap.ts` updated so a fresh Directus install includes the new field and enum values.

---

## 3. Multiple-quote selection link (item 1)

- Fix the "Public read not allowed on requests" error on `/q/:requestId`.
  - Re-apply / extend `scripts/directus-patch-public-quote.ts` so public role can read `requests` (scoped to the row, fields needed for quote page) **and** `request_quotes` rows.
- On the public quote page (`src/routes/q.$requestId.tsx`):
  - Render all uploaded quotes (not just the latest) with name, size, preview link.
  - Customer picks one and clicks **Confirm selection**.
  - Server records `selected_quote_id`, `quote_confirmed = true`, `quote_confirmed_at`, status → `quoted` (kept) and unlocks the staff "Send Payment Link" action.
- New Directus fields on `requests`: `selected_quote_id` (uuid, nullable). Patch script grants public update of just this field on the matching row.
- Staff side (`src/routes/requests.$id.tsx`): "Share Quote with Customer" copies the `/q/:id` link without error; once customer confirms, show the selected quote highlighted and enable Send Payment Link.

---

## 4. Session / idle logout (item 2)

- Update `src/services/directusClient.ts`:
  - Proactive token refresh: schedule refresh at `expires_at - 60s` (timer + visibility/focus re-check).
  - Wrap every request: on `401/expired_token`, attempt one refresh + retry before clearing the session.
  - Persist `refresh_token` and rotate on each refresh.
- `enforceActiveSession` no longer clears the session on a transient network error — only on a confirmed deactivated/`401 invalid_credentials` response.
- If refresh truly fails, show a toast: EN `Your session has expired. Please sign in again.` / AR `انتهت جلستك، يرجى تسجيل الدخول مرة أخرى.` before redirecting to `/login`.

---

## 5. Request lists — columns + search (items 3, 4, 5)

**Admin (`src/routes/admin.tsx`) & Supervisor (within admin scope)**
- Columns: Request ID · Customer Name · Sales/Agent Name · Underwriter Name · Client Type · Status · Created.
- Search box filters by Request ID **or** Customer Name (case-insensitive, debounced).

**Sales Agent dashboard (`src/routes/agent.tsx`)**
- Columns: Request ID · Customer Name · Underwriter Name · Client Type · Status · Created.
- Same search box.

**Underwriter dashboard**
- Add Client Type column for context (no other column changes).

All column labels and the search placeholder added to `src/i18n/translations.ts` (EN + AR).

---

## 6. ZIP download includes all submitted documents (item 6)

- In `src/services/api.ts` / `directusRequests.ts` `buildRequestZip` (or equivalent):
  - Pull every row from `request_files` for the request, not just the initial submission set.
  - Group folders by `doc_type` and submission round (e.g. `initial/registration/...`, `reupload-2026-06-20/...`, `corporate/trade_license/...`).
  - Include corporate files when `client_type = corporate`.
- ZIP filename keeps current convention but includes client type suffix.

---

## 7. Request History clarity

- `src/services/audit.ts` / history writers add explicit events:
  - `request.created`, `client_type.selected`, `documents.uploaded` (with counts per type), `missing_docs.requested`, `reupload.submitted`, `quote.shared`, `quote.selected_by_customer`, `quote.confirmed`, `payment_link.sent`, `status.changed`.
- `src/components/RequestHistoryTimeline.tsx`: render human-readable lines (EN + AR), never raw JSON. Add translation keys for each event type with parameter interpolation.

---

## 8. Visibility of `client_type` across portals

Show a small badge (Individual / Corporate) on:
- Request Details header
- Admin / Supervisor / Sales / Underwriter list rows
- Excel export (already enumerates requests — add column "Client Type")

---

## Server commands the user runs after deploy

```bash
DIRECTUS_URL=http://127.0.0.1:8055 DIRECTUS_ADMIN_TOKEN=<token> npx tsx scripts/directus-patch-client-type.ts
DIRECTUS_URL=http://127.0.0.1:8055 DIRECTUS_ADMIN_TOKEN=<token> npx tsx scripts/directus-patch-public-quote.ts
npm run build && pm2 restart al-diplomacy
```

---

## Files expected to change

- New: `scripts/directus-patch-client-type.ts`
- Edited:
  - `scripts/directus-bootstrap.ts`, `scripts/directus-permissions.json`, `scripts/directus-patch-public-quote.ts`
  - `src/routes/index.tsx`, `src/routes/r.$requestId.tsx`, `src/routes/q.$requestId.tsx`
  - `src/routes/admin.tsx`, `src/routes/agent.tsx`, `src/routes/requests.$id.tsx`
  - `src/services/api.ts`, `src/services/directusClient.ts`, `src/services/directusRequests.ts`, `src/services/directusEntities.ts`, `src/services/audit.ts`, `src/services/types.ts`
  - `src/components/RequestHistoryTimeline.tsx`, `src/components/OptionalDocsSection.tsx` (only if reused for corporate optional rows)
  - `src/i18n/translations.ts`

Both English and Arabic layouts covered throughout; all role gates (Admin / Supervisor / Sales / Underwriter) verified per feature.
