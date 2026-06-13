# Directus Schema & Permissions Blueprint

> هاد المرجع الرسمي لكل بنية الـ Directus. أي تعديل لاحق على المنطق (RLS / branch isolation / sales→underwriter routing) لازم ينعكس هنا أولاً ثم بسكربت `scripts/directus-bootstrap.ts`.

## التطبيق

```bash
export DIRECTUS_URL="https://directus.your-domain.ae"
export DIRECTUS_ADMIN_TOKEN="********"
npx tsx scripts/directus-bootstrap.ts          # collections + roles + permissions + flows
npx tsx scripts/directus-seed.ts               # users + branches + sample requests
```

السكربتات **idempotent** — تقدر تشغّلها مرات متعددة بدون تكرار.

---

## 1. Collections

### 1.1 `branches`
| field | type | flags |
|---|---|---|
| `id` | integer | PK, auto-increment |
| `name` | string | required, unique |
| `code` | string | required, unique |
| `address` | text | nullable |
| `phone` | string | nullable |
| `is_active` | boolean | default `true` |

### 1.2 `directus_users` — حقول مضافة
| field | type | notes |
|---|---|---|
| `app_role` | dropdown `admin` / `supervisor` / `agent` | required |
| `staff_type` | dropdown `underwriter` / `sales` | nullable (للـ agent فقط) |
| `branch` | M2O → `branches` | nullable للأدمن |
| `agent_code` | string | unique (e.g. `UW-001`, `SLS-001`) |
| `supervisor` | M2O → `directus_users` | nullable |
| `assigned_underwriter` | M2O → `directus_users` | للـ sales فقط |
| `pending_approval` | boolean | default `false` |
| `app_active` | boolean | default `true` |

> ملاحظة: ما رح ننشئ collection `agents` منفصل. الـ `directus_users` هو المصدر الوحيد للحقيقة، وهيك نستفيد من المصادقة المدمجة.

### 1.3 `requests`
| field | type | notes |
|---|---|---|
| `id` | string | PK يدوي بصيغة `REQ-1001` |
| `uuid` | uuid | auto |
| `agent` | M2O → users | المالك الحالي |
| `origin_agent` | M2O → users | السيلز الأصلي |
| `branch` | M2O → branches | required |
| `status` | dropdown | `new` / `linkSent` / `processing` / `sold` / `rejected` / `reupload` |
| `customer_name` | string | |
| `customer_email` | string | |
| `customer_phone` | string | |
| `assigned_at` | timestamp | |
| system fields | | `date_created`, `date_updated`, `user_created`, `user_updated` |

### 1.4 `request_notes`
| field | type |
|---|---|
| `id` | uuid PK |
| `request` | M2O → requests (cascade delete) |
| `author` | M2O → users |
| `author_role` | dropdown `admin`/`supervisor`/`agent` |
| `text` | text |
| `kind` | dropdown `comment` / `missing` |
| `resolved_at` | timestamp nullable |
| `date_created` | system |

### 1.5 `request_files`
| field | type |
|---|---|
| `id` | uuid PK |
| `request` | M2O → requests (cascade delete) |
| `file` | M2O → directus_files |
| `kind` | dropdown: `registration` / `license` / `emirates` / `vehicle_image` / `vehicle_video` / `inspection` / `attachment` / `missing_attachment` / `quote` |
| `uploaded_by` | M2O → users |
| `uploaded_at` | timestamp |

### 1.6 `notifications`
| field | type |
|---|---|
| `id` | uuid PK |
| `recipient` | M2O → users |
| `kind` | dropdown: `removal_requested`/`removal_approved`/`removal_dismissed`/`user_pending`/`user_approved`/`request_new`/`request_status`/`info` |
| `title` | string |
| `body` | text |
| `link` | string |
| `read` | boolean default `false` |
| `date_created` | system |

### 1.7 `audit_log`
| field | type |
|---|---|
| `id` | uuid PK |
| `ts` | timestamp |
| `actor` | M2O → users (nullable for anonymous) |
| `actor_role` | dropdown |
| `actor_branch` | string |
| `action` | string |
| `entity_type` | dropdown `request`/`agent`/`auth`/`branch` |
| `entity_id` | string |
| `entity_label` | string |
| `branch` | string |
| `before` | json |
| `after` | json |
| `meta` | json |

### 1.8 `app_settings` (singleton)
| field | type |
|---|---|
| `require_admin_approval` | boolean default `false` |

---

## 2. Roles & Policies

ثلاث رولز رئيسية. كل permission filter موثق بالتفصيل في `scripts/directus-permissions.json`.

### 2.1 Role: **Admin**
- `admin_access: true` على كل الـ collections.
- يقدر يغيّر `branch` / `supervisor` / `assigned_underwriter` / `app_role` لأي مستخدم.

### 2.2 Role: **Supervisor**
| collection | action | filter / fields |
|---|---|---|
| `branches` | read | all |
| `directus_users` | read | `{ branch: { _eq: "$CURRENT_USER.branch" } }` |
| `directus_users` | create | enforced: `branch = $CURRENT_USER.branch`, `app_role ∈ {agent}` |
| `directus_users` | update | same-branch only؛ ممنوع تعديل `app_role` لـ admin/supervisor؛ يقدر يعدّل `assigned_underwriter` و`supervisor` و`staff_type` و`app_active` |
| `directus_users` | delete | ❌ |
| `requests` | CRUD | `{ branch: { _eq: "$CURRENT_USER.branch" } }` |
| `request_notes` | CRUD | `{ request: { branch: { _eq: "$CURRENT_USER.branch" } } }` |
| `request_files` | CRUD | same |
| `audit_log` | read | `{ branch: { _eq: "$CURRENT_USER.branch.code" } }` |
| `notifications` | read/update | `{ recipient: { _eq: "$CURRENT_USER" } }` |
| `app_settings` | read | all |

### 2.3 Role: **Agent**
| collection | action | filter |
|---|---|---|
| `requests` | read | `{ _or: [ { agent: { _eq: "$CURRENT_USER" } }, { origin_agent: { _eq: "$CURRENT_USER" } } ] }` |
| `requests` | update | same-as-read، حقول: status/customer_*/assigned_at/agent (مع flow guard) |
| `requests` | create | sales only — `agent = $CURRENT_USER`, `origin_agent = $CURRENT_USER`, `branch = $CURRENT_USER.branch` |
| `requests` | delete | ❌ |
| `request_notes` | read/create | على الـ requests اللي يشوفها |
| `request_files` | read/create | كذلك؛ `kind=quote` مقيّد للـ underwriter (Flow) |
| `directus_users` | read | `{ branch: { _eq: "$CURRENT_USER.branch" } }`, fields: `id`, `first_name`, `last_name`, `agent_code`, `staff_type`, `app_role`, `branch` (لا email/password) |
| `notifications` | read/update | `{ recipient: { _eq: "$CURRENT_USER" } }` |
| `branches` | read | all (للـ dropdowns) |
| `app_settings` | read | all |

### 2.4 Role: **Public** (لا يوجد)
نشر عرض السعر للعميل يصير عبر **Flow webhook** على `/q/:uuid` يرجّع quote PDF بدون كشف الـ collection.

---

## 3. Flows (المنطق المشروط)

> **مهم**: عمليات `exec` في Directus ما عندها وصول لـ services. أي قراءة من DB لازم تكون عبر `item-read` operation. الـ flows أدناه multi-step chains مع `resolve` pointers.

| Flow | Trigger | Chain |
|---|---|---|
| `lovable: auto_assigned_at` | `requests.items.update` (filter) | `exec` → يضيف `assigned_at = now()` لو `agent` تغيّر |
| `lovable: enforce_sales_routing` | `requests.items.update` (filter, blocking) | `item-read` (me) → `condition` (sales+agent changed) → `exec` (throw if target ≠ assigned_underwriter) |
| `lovable: quote_kind_guard` | `request_files.items.create` (filter, blocking) | `condition` (kind=quote) → `item-read` (me) → `exec` (throw if not UW) |
| `lovable: reassign_request` | **webhook** `POST /flows/trigger/<id>` | `item-read` (me) → `exec` (validate role+target) → `item-update` (patch request.agent + assigned_at) |

**Reassignment flow هو الـ entry الوحيد لتعديل `requests.agent`** للـ agents — صلاحية `requests.update` للـ agent ما تشمل حقل `agent`. السيرفر هو اللي يقرّر.

الفرونت ينادي:
```ts
await dxReassignRequest(requestId, newAgentId, await dxFindReassignFlowId());
```

---

## 4. Storage / Localization (UAE)

- Self-host Directus على VPS داخل الإمارات (AWS me-central-1 / Etisalat / du).
- `directus_files` storage = MinIO أو S3-compatible داخل الـ region.
- Postgres داخل الإمارات.
- لا CDN خارجي للملفات الحساسة.

---

## 5. Frontend Wiring

عند التفعيل (`VITE_USE_DIRECTUS=true`):
- `src/services/directusClient.ts` ← العميل المركزي.
- `src/services/api.ts` ← يفصل بين demo و directus بحسب الـ flag.
- التوكن: access (10 دقائق) + refresh (7 أيام) → `localStorage` + auto-refresh.
- المنطق الموجود (assigned underwriter guard، branch filter) يبقى client-side كـ UX guard، السيرفر هو الحَكَم.
