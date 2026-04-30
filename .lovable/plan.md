
## نظرة عامة

ثلاث تعديلات على صفحة رفع المستندات (`/`):

1. إضافة حقل **رفع فيديو للمركبة** (أي صيغة فيديو).
2. تحويل **صور المركبة** و**الهوية الإماراتية (وجه + ظهر)** و**ملكية المركبة (وجه + ظهر)** إلى حقول **إجبارية** بدلاً من اختيارية.
3. عند الضغط على **شعار الراحة** في صفحة الرفع → التمرير السلس لقسم تعبئة بيانات العميل (KYC).

---

## 1) رفع فيديو للمركبة

- مكوّن جديد `VideoUploadCard.tsx` مبني على نفس نمط `UploadCard`:
  - `accept="video/*"` (يقبل أي فورمات: mp4, mov, webm, avi…)
  - حد أقصى للحجم: **50MB** (الفيديو أكبر من الصور).
  - معاينة الفيديو داخل البطاقة عبر `<video controls>` مع زر استبدال.
  - شريط تقدم محاكي كما في `UploadCard`.
- إضافة الحقل في `src/routes/index.tsx` كحقل **إجباري** ضمن قسم المستندات.
- توسيع `submitUpload` في `src/services/api.ts` لاستقبال `vehicleVideo: File` وتخزينه كـ data URL في `images.vehicleVideo`.
- توسيع نوع `InsuranceRequest.images` بإضافة `vehicleVideo?: string`.

ملاحظة: تخزين الفيديو في localStorage محدود (~5MB)، لذا في وضع الديمو سنخزّن **اسم الملف وحجمه فقط** (placeholder) بدل الـ data URL لتجنّب تجاوز الحد، ونترك الـ data URL الحقيقي للـ backend لاحقاً. سيظهر إشعار للمستخدم في الديمو.

## 2) جعل الحقول إجبارية (وجه + ظهر)

- **الهوية الإماراتية**: استبدال البطاقة الواحدة ببطاقتين:
  - `emiratesFront` — وجه الهوية (إجباري)
  - `emiratesBack` — ظهر الهوية (إجباري)
- **ملكية المركبة (Mulkiya)**: نفس الأمر:
  - `registrationFront` — وجه الملكية (إجباري)
  - `registrationBack` — ظهر الملكية (إجباري)
- **رخصة القيادة**: تبقى بطاقة واحدة (إجبارية كما هي).
- **صور المركبة** (`MultiUploadCard`): تتحول إلى **إجباري** بحد أدنى صورتين، وإزالة شارة "اختياري" (تمرير `optional={false}`).
- **فيديو المركبة**: إجباري (نقطة 1).
- **فحص المركبة**: يبقى اختيارياً.

تحديث منطق التحقق `docsReady` ليتحقق من جميع الحقول الإجبارية الجديدة (7 ملفات: registrationFront, registrationBack, license, emiratesFront, emiratesBack, vehicleVideo + ≥2 من vehiclePhotos)، وتحديث عدّاد "متبقّي X" تبعاً لذلك.

تحديث `submitUpload` و `InsuranceRequest.images`:
```ts
images: {
  registrationFront: string; registrationBack: string;
  license: string;
  emiratesFront: string; emiratesBack: string;
  vehiclePhotos: string[];          // كان optional → صار required
  vehicleVideo?: string;            // metadata في الديمو
  inspection?: string;              // يبقى optional
}
```
ملاحظة: هذا يكسر بنية الطلبات القديمة المخزّنة في localStorage. سنضيف migration بسيط في قارئ `getRequests` يحوّل `registration` القديم إلى `registrationFront` ويترك `registrationBack` فارغاً، حتى لا تنكسر صفحات `/admin` و `/agent` و `/requests/$id`.

تحديث صفحة تفاصيل الطلب `src/routes/requests.$id.tsx` لعرض الحقول الجديدة (الوجه والظهر للهوية والملكية، والفيديو إن وُجد).

تحديث ملفات الترجمة `src/i18n/translations.ts` بإضافة المفاتيح:
- `cards.registrationFront`, `cards.registrationBack`
- `cards.emiratesFront`, `cards.emiratesBack`
- `cards.vehicleVideo`
- `errors.videoBadType`, `errors.videoTooLarge`
- `errors.minVehiclePhotos` (مثلاً: "أضف صورتين على الأقل للمركبة")

## 3) النقر على الشعار يمرّر لقسم النموذج

- في `src/routes/index.tsx`: لفّ `<Logo />` بزرّ (`<button type="button">`) بدلاً من `<Link>`، يقوم بـ `scrollIntoView({ behavior: "smooth", block: "start" })` على قسم KYC.
- إضافة `id="kyc-section"` و `ref` لقسم KYC.
- لا يطبَّق على `Logo` في الصفحات الأخرى (login, dashboard…) — يبقى السلوك الحالي هناك.

---

## الملفات المتأثرة

- جديد: `src/components/VideoUploadCard.tsx`
- تعديل: `src/routes/index.tsx` (حقول جديدة، إجبارية، logo scroll)
- تعديل: `src/services/api.ts` (نوع `InsuranceRequest.images`، `submitUpload`، migration)
- تعديل: `src/routes/requests.$id.tsx` (عرض الحقول الجديدة)
- تعديل: `src/i18n/translations.ts` (مفاتيح AR/EN)

## ملاحظات تقنية

- الفيديو في وضع الديمو: نخزّن `{name, size, type}` فقط في localStorage لتجنّب QuotaExceededError، ونعرض اسم الملف في صفحة التفاصيل. عند الانتقال للـ backend الحقيقي يُرفع الملف لـ Storage bucket ويُخزّن الـ URL.
- `accept="video/*"` يفتح كاميرا الفيديو على الموبايل تلقائياً (مع `capture="environment"` لاحقاً إذا أردنا).
- الـ migration في `getRequests` يحمي البيانات الموجودة في localStorage من الكسر.
