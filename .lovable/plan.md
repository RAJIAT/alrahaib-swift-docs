# تقرير QA شامل — End-to-End

**نطاق الاختبار:** `https://rahaib.rajiatiyah.com` (Production) + الكود المصدري + بيانات Directus الفعلية عبر `/api/public/qa-audit`.

**ملاحظة:** لم تتوفر كلمات مرور حسابات Reda / Raji / Admin، فلم أستطع تنفيذ تدفقات التسجيل الكاملة في الـ UI. مع ذلك، تم التحقق من سلوك الـ Backend والصلاحيات والـ RLS فعليًا عبر استدعاءات API مباشرة + قراءة كود الـ Proxy.

---

## ✔ الأشياء الشغالة

| البند | النتيجة |
|---|---|
| `/`, `/login`, `/admin`, `/agent`, `/audit`, `/requests/1` | كل الصفحات HTTP 200 وتُحمّل |
| `/api/public/resolve-agent?agent_id=A21` | ✅ يرجع `{name:"رضا", branch:"AUH-MAIN"}` |
| `resolve-agent` Validation | ✅ يرفض agent فارغ / محارف خاصة (400) |
| **منع القراءة المجهولة** | ✅ `GET /items/requests`, `audit_log`, `request_notes`, `branches`, `users` كلها → **403** |
| **منع UPDATE/DELETE المجهول** | ✅ `PATCH /items/requests/1` → 403، `DELETE` → 403 |
| **منع POST audit_log المجهول** | ✅ → 403 |
| Admin token enrichment لـ `audit_log` | ✅ كود الـ proxy يضخ `actor_id/name/role/branch` من `/users/me` |
| Notes race fix (`?fields=*`) | ✅ مفعّل في الـ proxy |
| Mixed-content / Direct Directus | ✅ `http://api.rajiatiyah.com:8055` غير قابل للوصول من المتصفح (403 من خارجه أيضًا) |
| RBAC الأساسي | ✅ Admin / Supervisor / Agent منفصلون، لكل واحد policy خاص |
| البيانات داخل Directus | ✅ `users`, `branches`, `requests` موجودة فعليًا — ليست وهمية |

---

## 🔴 المشاكل الحرجة (Production Blockers)

### 1. أي شخص يستطيع إنشاء طلب فارغ بالكامل
`POST /api/directus/items/requests` بـ body `{}` يرجع **200** ويُنشئ صفًا في DB بكل الحقول `null`.
**دليل عملي:** أنشأت للتو الطلب `#8` بدون أي بيانات إطلاقًا.
**السبب:** الـ proxy يضخ `DIRECTUS_ADMIN_TOKEN` لأي POST مجهول على `items/requests` بدون أي validation.

### 2. أي شخص يستطيع انتحال `agent_id` غير موجود
`POST /items/requests` مع `agent_id:"FAKE_AGENT_1"` ينجح. أنشأت 5 طلبات spam بـ agent_ids مزوّرة كلها بحالة 200.
**التأثير:** سيول من الطلبات الوهمية، تشويش على الإحصائيات، عدم القدرة على المحاسبة.

### 3. رفع ملفات مجهول بدون أي قيود
`POST /api/directus/files` بـ multipart يقبل **أي ملف، أي نوع، أي حجم، أي اسم** بدون ربطه بطلب. أنشأت ملف `test.txt` يتيمًا الآن في storage.
**التأثير:** Storage abuse, malware upload, تكاليف تخزين غير محدودة.

### 4. لا يوجد Rate Limiting على endpoints المجهولة
نفّذت 5 طلبات إنشاء متوازية → كلها نجحت بدون أي throttling. أي bot يستطيع إنشاء آلاف الطلبات/دقيقة.

### 5. صلاحيات مكررة في Public Customer Upload Policy
qa-audit يكشف:
```
policy:Public Customer Upload:
  DUPLICATES: ['directus_files.create', 'requests.create']
```
صفّان متطابقان لنفس الصلاحية — يدل على أن سكربتات الإصلاح السابقة لم تنظّف الصفوف القديمة.

---

## ⚠️ المشاكل المحتملة (تحتاج تحقق ميداني بكلمة مرور حقيقية)

| البند | الوضع |
|---|---|
| Supervisor branch scoping | كود الإصلاح طُبّق سابقًا (filter `$CURRENT_USER.branch`) — لكن لم أتمكن من تأكيده بحساب حي. |
| Cross-agent access (Agent A21 يرى طلب وكيل آخر) | RLS موجود في policy، لكن لا يمكنني تأكيد الـ UI بدون login. |
| Audit log actor enrichment فعليًا | الكود صحيح، لكن لم أؤكد بـ POST من جلسة Agent حقيقية. |
| Form submission من المتصفح بحقول ناقصة | الفورم فيه `required` HTML — لكن أي bot يتجاوزها مباشرة عبر API كما أثبت أعلاه. |
| Login race condition (الحقل يفرغ) | لم يُختبر — يحتاج تجربة UI حية. |

---

## 🔧 المشاكل اللي لازم تنصلح فورًا

### إصلاحات Backend (في `src/routes/api/directus.$.ts`)

1. **Server-side validation للطلبات المجهولة قبل ضخ admin token:**
   - `POST /items/requests` (مجهول): يجب التحقق من
     - `customer_name` غير فارغ، طول 2-100
     - `customer_phone` أو `customer_email` على الأقل واحد منهما موجود وصالح
     - `agent_id` موجود فعليًا في `directus_users` (lookup قبل الإدخال)
     - رفض كل حقل خارج whitelist (status, agent_name تُحدَّد server-side فقط)
     - تعيين `agent_name` و `branch` تلقائيًا من lookup الوكيل (ليس من الـ body)

2. **حماية رفع الملفات المجهول:**
   - `POST /files` (مجهول): يتطلب header `x-request-token` (token مؤقت يُولَّد عند بدء الفورم) أو رفض الطلب
   - حد حجم الملف server-side (مثلاً 10MB)
   - whitelist للأنواع (image/jpeg, image/png, image/webp, application/pdf فقط)
   - رفض ملفات بدون امتداد معروف

3. **Rate limiting** (in-memory Map بسيط على IP):
   - resolve-agent: 30/دقيقة/IP
   - items/requests POST: 5/ساعة/IP
   - files POST: 20/ساعة/IP
   - رد 429 عند التجاوز

### إصلاحات قاعدة البيانات

4. **حذف البيانات الملوّثة الناتجة عن هذا الاختبار:**
   - حذف الطلبات #8, #9 + الـ 5 طلبات spam (ابحث عن `customer_name LIKE 'SPAM_%' OR customer_name = 'QA Test' OR customer_name IS NULL`)
   - حذف الملف اليتيم `9bebd704-78e1-43a9-8e15-349b8d584cd3`

5. **تنظيف صلاحيات Public Customer Upload المكررة** — حذف الصفوف المكررة في `directus_permissions` (التكرار يؤكد أن سكربت الـ maintenance لا يدمج، بل يضيف).

### إصلاحات الـ Maintenance Script

6. **في `runDirectusMaintenance`**: استخدام `upsertPermission` (الموجود أصلًا) بدل `ensurePermission` (الذي يتجاهل التكرار) عند إنشاء صلاحيات Public Customer Upload — وإضافة خطوة dedup صريحة عند بدء التشغيل.

---

## ملخص التنفيذ المقترح (عند الموافقة)

عند الانتقال لوضع البناء، ستُنفَّذ التغييرات بالترتيب:

1. تعديل `src/routes/api/directus.$.ts`:
   - دالة `validateAnonymousRequestBody(body)` تُفلتر الحقول، تتحقق من النوع/الطول، وتلغي ضخ admin token عند الفشل (400)
   - دالة `lookupAgentOrFail(agent_id)` تستخدم `DIRECTUS_ADMIN_TOKEN` للتحقق من وجود الوكيل وحقن `agent_name` + `branch` server-side
   - دالة `validateAnonymousFileUpload(request)` تتحقق من حجم/نوع الملف
   - دالة بسيطة `rateLimit(key, limit, windowMs)` بـ Map داخلي

2. سكربت dedup للصلاحيات المكررة + خطوة في `runDirectusMaintenance` لتنظيفها تلقائيًا في كل إقلاع.

3. سكربت تنظيف لمرة واحدة لحذف الطلبات الملوّثة + الملف اليتيم.

4. اختبار مكرر للسيناريوهات الحرجة بعد النشر للتأكد من أن:
   - `POST /items/requests` بـ `{}` → 400
   - `POST /items/requests` مع `agent_id:"FAKE"` → 400
   - رفع ملف 50MB → 413
   - 6 طلبات متتالية من نفس IP → الأخيرة 429

---

## النتيجة النهائية

النظام **ليس جاهزًا للإنتاج** بشكله الحالي. الـ RBAC للمستخدمين المسجّلين قوي ومحكَم، لكن **سطح الهجوم المجهول مكشوف بالكامل** عبر الـ proxy: أي شخص يستطيع إغراق DB بطلبات، تخزين ملفات عشوائية، وانتحال هويات الوكلاء.

**المخاطرة:** ساعة واحدة من bot يكفي لتدمير integrity البيانات بالكامل وملء storage.

هل توافق على تنفيذ الإصلاحات الست أعلاه؟
