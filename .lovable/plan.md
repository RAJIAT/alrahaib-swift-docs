## Goal

1. Restore the status/action buttons for Sales Agents (Sold, Payment Link Sent, Create Quote status, Reupload).
2. Make sure the dedicated "Send to Assigned Underwriter" action stays clearly visible — and also surface it inside the Quotes/Underwriter card when no quote has been uploaded yet.
3. Remove the leftover orange Middle East favicon so only the Al Diplomacy logo shows in tabs/bookmarks.

## Changes

### `src/routes/requests.$id.tsx` — re-enable Sales Agent actions
- Change `canChangeStatus` and `canRunFinalActions` so they are `true` for Sales Agents who own the request (own = `req.agent === user.agentId` or `req.originAgentId === user.agentId`), in addition to admin/supervisor/underwriter.
  - Net effect: the status dropdown and the "Create Quote / Sold / Payment Link Sent / Reupload" buttons render again for Sales.
- Keep the quote upload input gated to `isUW || isAdmin || isSup` (Sales still cannot upload the actual quote file).
- Leave the existing dedicated `ReassignCard` (which already renders the "Send to Assigned Underwriter" / "Request quote from underwriter" button for sales owners with a valid assigned underwriter) untouched.

### `src/routes/requests.$id.tsx` — surface Send-to-UW inside the empty Quotes card
- In `QuotesCard`, when `quotes.length === 0` AND viewer is the sales owner AND a valid assigned underwriter exists in the same branch, show a small "Send to Assigned Underwriter" button right next to the "Waiting for the underwriter…" message.
- The button reuses the same `reassignRequest` call path used by `ReassignCard` (assign to `meAgent.assignedUnderwriterId`, keep origin_agent, keep branch, success toast, refresh request).
- Hide the button once the request's `agent` already equals the assigned underwriter (already sent).

### Favicon cleanup
- Delete `public/favicon.ico` (old orange Middle East icon) and `public/logo.webp` if it is the same legacy asset.
- In `src/routes/__root.tsx`, keep only the Al Diplomacy entries:
  ```
  { rel: "icon", type: "image/png", href: "/al-diplomacy-logo.png" }
  { rel: "apple-touch-icon", href: "/al-diplomacy-logo.png" }
  ```
  Add an explicit `{ rel: "shortcut icon", href: "/al-diplomacy-logo.png" }` so browsers don't auto-discover `/favicon.ico`.
- Scan `index.html`, `deploy/nginx.conf`, and `deploy/.htaccess` for any remaining `favicon.ico` / `logo.webp` references and remove them.

## Verification

- Open a request as a Sales Agent: status dropdown + Sold/Reupload/Payment-Link/Create-Quote buttons visible; dedicated "Send to Assigned Underwriter" card visible; Quotes card empty-state shows inline "Send to Assigned Underwriter" button.
- Open a request as Underwriter/Admin/Supervisor: behavior unchanged.
- Hard refresh the preview: only the Al Diplomacy logo appears as favicon; `/favicon.ico` returns 404 (or the Al Diplomacy PNG).

## Out of scope

- No backend/permission changes (Directus already allows sales → assigned underwriter via the existing `enforce_sales_routing` flow).
- No changes to status semantics or notification logic.
