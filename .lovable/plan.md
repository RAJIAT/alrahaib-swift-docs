## Goal
Make the app feel like a real production system while remaining frontend-only. All data persists in localStorage, including actual uploaded images (stored as base64 data URLs) so admins/agents see the real submissions instead of stock photos.

## 1. Mock API upgrades (`src/services/api.ts`)
- Convert each uploaded `File` to a base64 data URL inside `submitUpload` and store it in `images.{registration,license,emirates}` so the request detail page shows the actual uploaded files (PDFs included via a small PDF icon fallback).
- Generate a proper unique ID: `REQ-` + zero-padded incrementing counter persisted in localStorage.
- Capture: real `createdAt` timestamp, `agentId` from URL, `status: "new"`, branch derived from agent.
- Add `resetDemo()` to clear `aib_requests` + `aib_auth_user` and re-seed.
- Add `subscribeRequests(cb)` using a `storage` event + a custom `aib:requests-changed` event dispatched after every write, so dashboards refresh live when a new upload happens (even in same tab).
- Slightly increase realistic delay (700–1200ms) for `submitUpload`.

## 2. Upload page (`src/components/UploadCard.tsx` + `src/routes/index.tsx`)
- UploadCard: after a file is selected, run a simulated progress (0→100% in ~1.2s) shown as a thin progress bar overlay, then show "Uploaded ✓" pill and the preview. Keep PDF fallback icon.
- Index page submit flow:
  1. Click submit → button shows spinner + label "جارٍ رفع المستندات..."
  2. Await `submitUpload` (now base64-encodes files).
  3. Brief inline success check animation, then `navigate({ to: "/success", search: { id } })`.
  4. Toast on failure.
- Pass real submitted ID to success page via search param.

## 3. Success page (`src/routes/success.tsx`)
- Animated check (scale-in), show the new request ID ("رقم الطلب: REQ-1008").
- Buttons: "رفع مستندات أخرى" + (if logged in) link to dashboard.

## 4. Agent dashboard (`src/routes/agent.tsx`)
- Add header strip: "هذه الطلبات تخصك فقط" with user's name.
- Add 3 small live stat chips (total / new / sold) scoped to the agent.
- Subscribe to `aib:requests-changed` so new uploads appear instantly without refresh.
- Empty state: friendly icon + message + link back to upload page.
- Smooth fade-in for list items.

## 5. Admin dashboard (`src/routes/admin.tsx`)
- Stats already present — make them recompute from `filtered` AND keep an "all" totals row, plus a "Today" stat.
- Subscribe to live updates (same hook).
- Improve filters: keep current select set, add active-filter chip row with quick-remove, working as today.
- Empty state with icon when filtered list is empty.

## 6. Request details (`src/routes/requests.$id.tsx`)
- Replace ad-hoc "Saved ✓" inline label with a `sonner` toast: "تم تحديث الحالة" / "Status updated".
- Keep zoom modal; add fade/scale transitions (Tailwind `animate-fade-in`, `animate-scale-in`).
- Handle PDF "image" sources (data URLs starting with `data:application/pdf`) by rendering an embedded `<iframe>` instead of `<img>` in zoom view.

## 7. Demo mode UX
- New `src/components/DemoBanner.tsx`: thin top strip "نسخة تجريبية — Demo Mode" with a small "إعادة تعيين البيانات" button that calls `resetDemo()` then `window.location.reload()` (with confirm dialog).
- Mount banner globally in `src/routes/__root.tsx` above `<Outlet />`. Layouts (`DashboardShell`, upload page header) get a small top offset.

## 8. Translations (`src/i18n/translations.ts`)
Add keys (AR + EN):
- `demo.banner`, `demo.reset`, `demo.confirmReset`
- `upload.uploadingDocs` ("جارٍ رفع المستندات...")
- `upload.progress` label
- `success.requestId`, `success.goToDashboard`
- `agent.yoursOnly` ("هذه الطلبات تخصك فقط")
- `agent.statsTotal/New/Sold`
- `details.statusUpdated` ("تم تحديث الحالة")
- `common.empty.title`, `common.empty.subtitle`

## 9. UX polish (global)
- Add `transition active:scale-[0.98]` to all primary buttons.
- Use `animate-fade-in` on page main containers and `animate-scale-in` on the success check + zoom modal.
- Standardize spinner usage with `Loader2 className="animate-spin"`.
- Ensure `<Toaster />` from sonner is mounted in `__root.tsx` (richColors, position top-center, RTL-aware via dir on body).

## 10. Performance
- Cap base64 stored images at ~1.5MB by downscaling images via an offscreen canvas before saving (max 1600px on the longest edge, JPEG q=0.85). PDFs stored as-is up to 2MB; oversize files get a soft warning toast.

## Technical notes
- localStorage keys: `aib_requests`, `aib_auth_user`, `aib_seq` (counter).
- File→base64: `FileReader.readAsDataURL`, wrapped in a Promise.
- Image downscale: `createImageBitmap` → `OffscreenCanvas` (fallback to `<canvas>`).
- Live updates: dispatch `new CustomEvent("aib:requests-changed")` after every `save()`; dashboards `useEffect` add/remove listener.
- No new dependencies — sonner, lucide-react, TanStack Router are already installed.

## Files
- edit: `src/services/api.ts`, `src/components/UploadCard.tsx`, `src/routes/index.tsx`, `src/routes/success.tsx`, `src/routes/agent.tsx`, `src/routes/admin.tsx`, `src/routes/requests.$id.tsx`, `src/routes/__root.tsx`, `src/i18n/translations.ts`
- new: `src/components/DemoBanner.tsx`, `src/components/EmptyState.tsx`, `src/lib/imageUtils.ts`, `src/hooks/useRequestsLive.ts`
