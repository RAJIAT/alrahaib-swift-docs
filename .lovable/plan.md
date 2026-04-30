
## الهدف
1. إضافة دور **Supervisor** بين Admin و Agent — يشوف فرعه فقط، ما يقدر يحذف.
2. خيار **حفظ الصور** اللي ينرفعها العميل (تنزيل لجهازه).
3. إصلاح مشكلة تعليق الصفحة عند تغيير حالة الطلب (Sold/Quote/...).
4. مراجعة شاملة لمنع الكراش/الـ redirect loops.

---

## 1) دور Supervisor (الجديد)

**الصلاحيات:**
| الإجراء | Admin | Supervisor | Agent |
|---|---|---|---|
| رؤية كل الفروع | ✓ | ✗ (فرعه فقط) | ✗ |
| رؤية كل الوكلاء بفرعه | ✓ | ✓ | ✗ (نفسه فقط) |
| تغيير حالة الطلب | ✓ | ✓ | ✓ |
| حذف وكيل/طلب | ✓ | ✗ | ✗ |
| إدارة الوكلاء (إضافة/تعديل) | ✓ | ✗ | ✗ |

**التعديلات التقنية:**
- `src/services/api.ts`: إضافة `"supervisor"` إلى type `Role`. إضافة مستخدم تجريبي `supervisor@aib.com` مرتبط بفرع `Abu Dhabi`. إضافة helper `canDelete(user)` و `canSeeAllBranches(user)`.
- `src/routes/agent.tsx` → تحويلها لتدعم Supervisor: لو الدور supervisor، تجيب طلبات كل الوكلاء اللي بنفس فرعه (بدل agentId واحد). `listRequests` يدعم خيار جديد `{ branch?: string }`.
- `src/routes/admin.tsx`: السماح للـ supervisor بالدخول لكن مع فلتر فرع مقفول على فرعه + إخفاء أزرار الحذف.
- `src/components/DashboardShell.tsx`: قائمة جانبية مخصّصة للـ supervisor (Dashboard فقط، بدون Manage Agents).
- `src/routes/agents.tsx` و `requests.$id.tsx`: إخفاء زر **Delete** إذا الدور ليس admin.
- `src/routes/login.tsx`: إضافة زر "Quick fill as Supervisor".
- Translations: مفاتيح `roles.supervisor`, `nav.supervisorView`, إلخ.

---

## 2) حفظ الصور بعد الرفع

في صفحة **تفاصيل الطلب** (`requests.$id.tsx`):
- إضافة زر **تنزيل** على كل بطاقة صورة/PDF (icon Download فوق الصورة).
- إضافة زر **تنزيل الكل (ZIP)** أعلى الصفحة — يبني ZIP في المتصفح باستخدام مكتبة خفيفة (`jszip`) ويحمّله باسم `REQ-1001.zip`.
- داخل modal التكبير: زر تنزيل إضافي.
- يدعم الصور (PNG/JPG) و PDF بنفس الآلية (data URL → Blob → download).

اختياري: زر "حفظ نسخة" بعد نجاح الرفع في صفحة Success (يحفظ ملفات العميل اللي رفعها للتو).

---

## 3) تعليق الصفحة عند تغيير الحالة + Crashes

**التشخيص:**
- `requests.$id.tsx` فيه `useEffect` يعتمد على `user` (object من `getCurrentUser()`) — كل render يرجع reference جديد → infinite loop محتمل.
- `DashboardShell` كمان فيه `useEffect` بيستدعي `navigate({ to: "/login" })` بدون شرط دقيق — لو state ما تحدّث لحظياً يصير redirect-then-back.
- `updateRequestStatus` بيعمل `notifyChange()` → كل المشتركين بـ `useRequestsLive` يعيدوا `listRequests` → re-render كبير على صفحة التفاصيل.

**الإصلاحات:**
- `requests.$id.tsx`: إزالة `user` من dependency array، استخدام `useRef` أو قراءة `getCurrentUser()` مرة واحدة. إضافة guard `if (req.status === s) return` قبل التحديث.
- `DashboardShell.tsx`: تشغيل التحقق من الدور مرة واحدة فقط (`useEffect` بـ `[]` + قراءة المستخدم داخلها)، وإلغاء `setUser(getCurrentUser())` المتكرر.
- `useRequestsLive.ts`: عدم استدعاء `setLoading(true)` في كل refresh — فقط أول مرة. منع state update لو الـ list ما تغيّرت فعلياً (مقارنة طول + آخر updatedAt).
- إضافة **Error Boundary** على الـ root (`__root.tsx`) — أي exception يظهر شاشة خطأ نظيفة بدل blank/redirect.
- `index.tsx` (صفحة العميل): تحويل تحويل الملفات إلى data URL كبيرة من sync إلى chunked — لو الملف أكبر من 1MB يرفع `setSubmitting(false)` على exception ويظهر toast واضح بدل تجميد الصفحة.

---

## 4) Stability Sweep (مراجعة شاملة)

- فحص كل `useEffect` في المشروع للتأكد من dependency arrays صحيحة (لا references غير مستقرة).
- فحص كل `navigate({ to: "/login" })` للتأكد من ما في loops (إذا أصلاً على /login، ما يعمل redirect).
- التأكد من إن `localStorage` reads كلها داخل `typeof window !== "undefined"` guards (مهم لـ SSR في TanStack Start).
- إضافة `try/catch` حول كل `JSON.parse` من localStorage.
- التأكد من إن أي async مع `await` فيه catch — خاصة في handlers الأزرار.

---

## الملفات اللي رح تتعدّل
- `src/services/api.ts` — supervisor role + branch filtering
- `src/routes/agent.tsx` — supervisor view
- `src/routes/admin.tsx` — branch lock for supervisor
- `src/routes/agents.tsx` — hide delete for non-admin
- `src/routes/requests.$id.tsx` — fix loop + download buttons + branch-scoped status update
- `src/routes/login.tsx` — supervisor quick-fill
- `src/routes/__root.tsx` — Error Boundary
- `src/routes/index.tsx` — robust submit error handling
- `src/components/DashboardShell.tsx` — supervisor nav + fix redirect loop
- `src/hooks/useRequestsLive.ts` — منع re-render غير ضروري
- `src/i18n/translations.ts` — مفاتيح جديدة (AR/EN)
- إضافة dependency: `jszip`

---

## ملاحظة للعميل
الديمو رح يضل شغّال على **localStorage** بدون باكند — كل التحسينات هنا UX/استقرار + ميزات. بمجرد تجهيز السيرفر بالإمارات، نوصل كل هاد بقاعدة بيانات حقيقية بدون تغيير الواجهة.
