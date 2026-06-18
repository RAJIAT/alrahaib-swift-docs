Plan to fix the broken Agent dashboard link/name:

1. Fix the Agent dashboard data source
- Build one `agentDisplayName` from the real logged-in profile fields first: `firstName + lastName`, then `user.name`, then linked agent cache name, then email username.
- Use that same name in the welcome header so it shows `أهلاً، Raji atiyah` instead of only `أهلاً،`.

2. Fix the upload link generation
- Replace the current client-only `window.location.origin` link calculation with a stable helper that always returns a URL after render.
- Generate the slug from `firstName + lastName + agent_code` when available.
- If `agent_code` is missing, generate `raji-atiyah` from the visible user name.
- Never fall back to `agent`, UUID, `user.id`, `agent.id`, or `profile.id` for the dashboard-visible/copied/shared link.

3. Fix the visible link field and badge
- Make the visible field show the final URL text, not an empty string.
- Make the badge show the readable slug/code derived from the same helper.
- Copy and Share buttons will use the exact same final URL shown on screen.

4. Preserve upload-page resolution
- Keep old UUID links resolving for backward compatibility.
- Ensure readable slugs like `raji-atiyah` and `raji-atiyah-sls-8039` resolve to the correct Sales Agent internally.

5. Add/keep clear diagnostics
- Log:
  - `[agent upload link] user fields`
  - `[agent upload link] final slug`
  - `[agent upload link] final url`
  - `[upload agent resolver] input`
  - `[upload agent resolver] resolved agent`

Technical details:
- Primary files: `src/routes/agent.tsx`, with possible small resolver adjustment in `src/services/directusRequests.ts` only if needed.
- Main likely cause: dashboard is passing an empty/invalid name into `ShareLinkCard`; the slug helper returns empty, so the URL div renders blank and the welcome text uses the sparse `user.name` value.