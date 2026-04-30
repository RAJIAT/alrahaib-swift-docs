# خطة تحديثات صفحة المشرف ورفع الملفات

## 1. إخفاء زر تسجيل الدخول من صفحة العميل
**الملف:** `src/routes/index.tsx`
- حذف الـ `<Link to="/login">` (السطور 134-140) من header صفحة الرفع
- يبقى الشعار والـ LanguageSwitcher فقط — الشعار ما يحوّل لأي مكان للعميل
- ملاحظة: المسؤولون لسا يقدروا يفتحوا `/login` مباشرة من شريط العنوان

## 2. حالة جديدة "تم إرسال الرابط" (linkSent)
**الملفات:**
- `src/services/api.ts`: إضافة `"linkSent"` إلى `RequestStatus`
- `src/i18n/translations.ts`: ترجمات AR/EN (مثلاً "تم إرسال الرابط" / "Link sent")
- `src/components/StatusBadge.tsx`: لون مميز (مثلاً أزرق فاتح)
- `src/routes/requests.$id.tsx`: إضافة الحالة في dropdown تغيير الحالة
- متاح يدوياً للعميل (الايجنت) وللسوبرفايزر

## 3. نظام الكومنتات (نواقص + ملاحظات داخلية)
**هيكل البيانات الجديد** على كل طلب:
```
notes: Array<{
  id, authorId, authorName, authorRole,
  text, kind: "comment" | "missing",
  createdAt, resolvedAt?
}>
```
**الملفات:**
- `src/services/api.ts`: إضافة `notes[]` لـ `InsuranceRequest` + دوال `addNote` / `resolveNote`
- `src/routes/requests.$id.tsx`: قسم جديد "ملاحظات ونواقص" جنب الـ Actions (مش thread منفصل):
  - حقل إدخال + زرّين: "إضافة كومنت" و "إضافة نقص"
  - عرض كرونولوجي مع: اسم الكاتب، الدور (Agent/Supervisor/Admin)، الوقت، نوع المدخل (شارة)
  - النواقص لها زر "تم الحل" (يضيف `resolvedAt`)
- يشوفه: agent + supervisor + admin (الكل على نفس الطلب)

## 4. رابط النواقص للعميل (نفس الكيس)
**التصرف:** الرابط الموجود حالياً للطلب الجديد (`/`) يُعاد استخدامه — لما السوبرفايزر يضيف "نقص" + يحوّل الحالة لـ `reupload`، يقدر ينسخ رابط خاص بنفس الكيس:

**الرابط الجديد:** `/r/$requestId` (route جديد)
- يفتح صفحة رفع مبسطة للعميل (بدون header login، بدون KYC)
- يعرض قائمة النواقص المطلوبة (من `notes` كنوع `missing` غير محلولة)
- يسمح برفع ملفات جديدة تنضاف لنفس الـ request
- بعد الرفع: الحالة ترجع `processing` تلقائياً والنواقص تتعلّم resolved

**الملفات:**
- `src/routes/r.$requestId.tsx` (route جديد)
- `src/services/api.ts`: دالة `appendFilesToRequest(id, files[])`
- زر "نسخ رابط النواقص" بصفحة `requests/$id` يظهر فقط لما الحالة `reupload`

## 5. رفع الصور: الأولى إجبارية، الثانية اختيارية (حتى لو PDF)
**الوضع الحالي:** بطاقة الملكية/الرخصة/الهوية كلها `min={2} max={2}` (إجباري وجه + ظهر)
**التعديل:** تصير `min={1} max={2}` — الوجه إجباري، الظهر اختياري
**الملفات:**
- `src/routes/index.tsx`: تحديث الـ 3 بطاقات (registration, license, emirates)
- `src/components/MultiUploadCard.tsx`: التحقق من سلوك min=1
- تحديث رسائل التحقق + النصوص التلميحية (`registrationHint`, `licenseHint`, `emiratesHint`)
- تحديث `docsReady` و `remaining` بحيث يكفي ملف واحد لكل بطاقة

## 6. مرفقات إضافية (اختيارية، عدد مفتوح، كل الصيغ ما عدا الفيديو)
**ملاحظة:** "بدون" بنهاية طلبك غير مكتملة — أفترض المقصود **بدون فيديو** (نفس منطق `vehiclePhotos` الحالي يقبل فيديو، نخلي الجديد صور/PDF/أوفيس فقط). إذا قصدك شي تاني وضّحلي.

**الملفات:**
- `src/services/api.ts`: حقل جديد `images.attachments: Array<{name, type, size, url}>`
- `src/routes/index.tsx`: قسم Optional uploads — إضافة `MultiUploadCard` جديد:
  - `min={0}`, `max={Infinity}` (أو 20 كحد أمان)
  - accept: `image/*,application/pdf,.doc,.docx,.xls,.xlsx` (بدون فيديو)
- `src/routes/requests.$id.tsx`: عرض المرفقات الإضافية بقسم منفصل + ZIP يضمها

## 7. رفع حد حجم الملف من 2MB إلى 5MB
**الملفات:**
- `src/lib/imageUtils.ts`: `MAX_PDF_BYTES = 5 * 1024 * 1024`
- `src/components/MultiUploadCard.tsx`: `IMAGE_MAX_BYTES = 5 * 1024 * 1024`
- `src/components/UploadCard.tsx`: `MAX_BYTES = 5 * 1024 * 1024`
- تحديث رسائل الخطأ (`tooLarge`) لتعكس 5MB

## تفاصيل تقنية

### Migration للبيانات الموجودة
- `readRequests` في `api.ts` ينضاف له:
  - تعبئة `notes: []` للطلبات القديمة
  - تعبئة `images.attachments: []`
- لا migrations DB لأن المشروع localStorage demo حالياً

### الحالات النهائية
`new` → `linkSent` → `processing` → (`sold` | `rejected` | `reupload`)

### ملفات ستُعدّل (ملخص)
- `src/services/api.ts` (types + notes API + attachments + appendFiles)
- `src/i18n/translations.ts` (AR/EN strings كثيرة)
- `src/routes/index.tsx` (إخفاء login + min=1 + attachments card)
- `src/routes/requests.$id.tsx` (notes section + linkSent + copy reupload link + attachments)
- `src/routes/r.$requestId.tsx` (جديد — صفحة رفع نواقص)
- `src/router.tsx` / route tree (auto-gen)
- `src/components/StatusBadge.tsx` (لون linkSent)
- `src/components/MultiUploadCard.tsx` (5MB + min=1 path)
- `src/components/UploadCard.tsx` (5MB)
- `src/lib/imageUtils.ts` (5MB)

## نقطة تحتاج تأكيد
- المرفقات الإضافية: **بدون فيديو** صح؟ أم **بدون نوع معين آخر**؟