## Plan

1. **Use real `/users/me` fields for the Agent dashboard link**
   - Extend the cached logged-in user shape to preserve `first_name` and `last_name` from `/users/me`.
   - Pass `first_name`, `last_name`, `email`, and `agent_code` into the Agent dashboard upload-link helper.
   - Update `buildAgentUploadSlug(user)` so it builds:
     - `first_name + last_name + agent_code` when code exists
     - `first_name + last_name` when code is missing
     - email username only as a fallback
   - Remove the generic `agent` fallback and never use UUID values in the displayed/copied/shared URL.
   - Keep the card visible by falling back to a readable non-UUID field such as email username if names are missing.

2. **Make one shared final URL inside the card**
   - Compute one `slug` and one `uploadUrl`.
   - Use that exact `uploadUrl` for the visible link, badge, Copy button, and Share button.
   - Add the requested logs:
     - `[agent upload link] user fields`
     - `[agent upload link] final slug`
     - `[agent upload link] final url`

3. **Fix customer upload slug resolution**
   - Update `dxResolveUploadAgent(identifier)` so it can resolve readable name slugs like `raji-atiyah`, not only UUIDs or trailing `SLS-####` codes.
   - When the slug contains no agent code, fetch Sales Agent users with safe public fields and match by slugified `first_name + last_name` and email username.
   - Preserve old UUID and agent-code links for backward compatibility.
   - Add the requested resolver logs:
     - `[upload agent resolver] input`
     - `[upload agent resolver] resolved agent`

4. **Submit upload through resolved agent**
   - Keep `submitUpload` using `dxResolveUploadAgent()` before request creation so customer uploads are assigned to the resolved Sales Agent user ID.
   - Ensure the expected link `https://app.al-dis.com/?agent=raji-atiyah` resolves to Raji Atiyah and no longer throws `Sales Agent not found for this upload link`.