# Directus Integration — Setup Guide

This app speaks to **Directus** (self-hosted) via REST. All data and files
stay on your own infrastructure (On-Premise or Azure UAE) — no external
SaaS, satisfying the UAE data-residency requirement.

The app falls back to a localStorage demo when `VITE_DIRECTUS_URL` is not set,
so the frontend can be developed and demoed without a backend.

---

## 1. Deploy Directus inside the UAE

Pick one:

- **On-Premise**: Docker on your internal server.
- **Azure UAE North / Central**: Azure Container Apps / VM + Azure Database
  for PostgreSQL (UAE region) + Azure Blob Storage (UAE region) for files.

Minimum components:
- Directus 11+ (Docker image `directus/directus:latest`)
- PostgreSQL 14+ (or Azure Database for PostgreSQL)
- File storage:
  - **Recommended**: Directus default local storage (volume on the same VM/AKS).
  - Or S3-compatible / Azure Blob — configure via Directus env vars.

Make sure:
- The Directus URL is reachable from end-users' browsers (HTTPS).
- CORS allows your frontend origin (`CORS_ENABLED=true`, `CORS_ORIGIN=https://your-frontend.ae`).

## 2. Create the data model

In Directus admin, create one collection:

### Collection: `requests`

| Field          | Type                    | Notes                                      |
| -------------- | ----------------------- | ------------------------------------------ |
| `id`           | UUID, primary, auto     | default                                    |
| `status`       | String                  | default: `new`. Values: new, processing, sold, rejected, reupload |
| `agent_id`     | String                  | indexed                                    |
| `agent_name`   | String, nullable        |                                            |
| `branch`       | String, nullable        |                                            |
| `registration` | File (M2O → directus_files) |                                        |
| `license`      | File (M2O → directus_files) |                                        |
| `emirates`     | File (M2O → directus_files) |                                        |
| `date_created` | Timestamp, special: date-created | auto                              |

## 3. Roles & permissions

Create three roles:

### Role: **Public** (anonymous customer upload)
- `directus_files`: **create**
- `requests`: **create** (no read)
- Field-level: only allow customer to set `agent_id`, `agent_name`,
  `branch`, `registration`, `license`, `emirates`. `status` defaults to `new`.

### Role: **Agent**
- `requests`: **read** with filter
  `{ "agent_id": { "_eq": "$CURRENT_USER.agent_id" } }`
- `directus_files`: **read** (so the agent can view their own uploads)

### Role: **Admin**
- `requests`: **read**, **update** (full)
- `directus_files`: **read**
- `directus_users`: **create**, **read**, **update**, **delete**
  (so the admin can manage agent accounts from `/agents` in the app)
- `directus_roles`: **read** (needed to look up the Agent role id when creating users)

### Custom fields on `directus_users`

In Directus → Settings → Data Model → Directus Users, add:

| Field      | Type   | Notes                                          |
| ---------- | ------ | ---------------------------------------------- |
| `agent_id` | String | Business identifier used in the customer URL. |
| `branch`   | String | Branch name (Abu Dhabi, Dubai, ...).          |

These fields are read by the app (`/users/me`) and used to scope the agent's
own dashboard. The `status` field already exists on Directus users — set it to
`active` for working accounts; the admin UI uses `suspended` to disable login
without deleting the account.

## 4. Create the first Admin

Manually create one Admin user in Directus → User Directory (assign Admin role).
Then log into the app with that admin and use **Manage Agents** to create
agent accounts going forward — no SQL or Directus admin access needed for
day-to-day operations.

## 5. Configure the frontend

Create a `.env` file at the project root (or set the variable in your build env):

```
VITE_DIRECTUS_URL=https://api.alrahaib.ae
```

Rebuild / restart. The demo banner disappears and all calls now go to Directus.

The demo accounts (`agent@aib.com`, `admin@aib.com`) stop working — use the
real Directus credentials.

## 6. Customer upload URL

Customers receive a link like:

```
https://app.alrahaib.ae/?agent=A123
```

The `agent=...` value is stored on the new request as `agent_id` and is
how the agent dashboard scopes "my requests only".

## 7. Verify data residency

- ✅ DB: PostgreSQL inside UAE region.
- ✅ Files: Local volume on UAE VM or Azure Blob UAE region.
- ✅ Compute: Directus container in UAE region.
- ✅ Frontend: served from UAE-hosted CDN / web server.
- ✅ Zero external SaaS in the request path.
