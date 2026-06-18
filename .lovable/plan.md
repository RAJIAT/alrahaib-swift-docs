## Plan

### 1. Fix customer upload Agent name display
- Update the public upload page (`/?agent=...`) so it never renders `Agent: …`, empty text, UUIDs, or a slug as the final label.
- Strengthen the agent resolver to return a clean display name:
  - Prefer `first_name + last_name`.
  - Fallback to email username if names are missing.
  - Use agent code only as optional secondary info, never as the primary name.
- Include `email` in the safe public agent lookup fields and update the public-upload permission patch so anonymous lookup can read only the safe fields needed for display.
- Add Arabic/English label handling:
  - English: `Agent: Raji Atiyah`
  - Arabic: `الوكيل: Raji Atiyah`

### 2. Fix Request History event creation and display
- Make audit writes reliable instead of silently failing:
  - Surface useful console warnings when `audit_log` creation fails.
  - Ensure public customer upload creates a `request.created` / customer submitted documents event with anonymous/customer actor.
  - Ensure transfer to underwriter creates:
    - `Request assigned to Underwriter [name]`
    - `Status changed: New → Processing`
  - Ensure automatic status changes for reupload, quote upload/share, and payment link are recorded.
  - Ensure manual status changes include `meta.manual = true` and render as `Status changed manually: Old → New`.
- Fix Request History fetching if the UI is filtering by the wrong ID shape (`REQ-...` vs internal UUID/label) by querying the correct request event identifiers.
- Keep history readable in EN/AR and avoid raw JSON unless the advanced/admin view is explicitly used.

### 3. Fix manual status change availability
- Keep the status selector visible on the Request Details header for all allowed users:
  - Admin
  - Supervisor
  - Sales Agent
  - Underwriter
- Ensure it is available at every stage, not only final stages.
- Confirm selector includes exactly:
  - New
  - Under Process / Processing
  - Missing Info / Reupload
  - Quoted
  - Payment Link Sent
  - Sold
  - Rejected
- Keep automatic status updates active, but manual changes should always be possible and should log a clean history event.

### 4. Directus permission/server patch updates
- Update or add the required `npx tsx` patch script(s) so the server can grant:
  - Public safe read fields for agent lookup, including email fallback.
  - Public/audited customer upload event creation if allowed by the current Directus model.
  - `audit_log.create` for Agent and Supervisor roles.
  - `audit_log.read` for Agent/Supervisor/Admin so Request History can read request events for the correct branch/owned request.
- Final response will include the exact Node/npm/npx/tsx command(s) to run on the server, using `https://app.al-dis.com` for app-facing URLs and no Bun commands.

### 5. Validation
- Run read-only/code checks and targeted tests where available using Node/npm/npx/tsx only.
- Verify the flow logic end-to-end in code:
  - Agent link displays readable sales name.
  - Customer upload logs history.
  - Transfer to underwriter logs transfer and status.
  - Manual status change logs manual status history.
  - Request History shows events for Admin, Supervisor, Sales Agent, and Underwriter.