الخطة:

1. إصلاح تعيين الـ Underwriter من صفحة Agents / Underwriters
- تعديل نافذة إضافة/تعديل المستخدم حتى تعمل refresh لقائمة الـ agents عند فتحها، بدل الاعتماد على cache قديم.
- في تعديل sales agent، إظهار حقل Assigned Underwriter دائماً إذا كان الموظف Sales.
- فلترة خيارات الـ underwriter حسب نفس الفرع بشكل موثوق، مع دعم حالات branch المخزنة ككود أو id.
- إذا ما في underwriter بنفس الفرع، إظهار رسالة واضحة بدل اختفاء الخيار.
- التأكد أن supervisor يقدر يعدل assigned underwriter للـ sales agent داخل فرعه بدون حذف المستخدم.

2. جعل صفحة الطلبات تتحدث بدون Refresh بعد رفع العميل
- تعديل `useRequestsLive` حتى توقيع التحديث لا يعتمد فقط على `id/status`، بل يشمل عدد الملفات/النواقص/آخر تحديث.
- عند polling كل 4 ثواني، أي upload جديد على نفس الطلب يظهر في agent dashboard فوراً بدون refresh.
- الحفاظ على الـ toast الحالي كتحسين UX، لكن بدون إنشاء notifications مكررة من الواجهة إذا الـ Flow أنشأها بالفعل.

3. تحسين تحديث صفحة تفاصيل الطلب
- التأكد أن صفحة تفاصيل الطلب تعيد تحميل الطلب عند تغيّر الملفات أو status.
- إذا العميل رفع مستندات على request مفتوح، تظهر الملفات مباشرة داخل التفاصيل خلال polling.

4. Directus/server-side patch
- تحديث bootstrap والـ one-off patch حتى permissions الخاصة بـ supervisor/agent تشمل حقول `assigned_underwriter` بشكل ثابت.
- إصلاح/تعزيز flow رفع العميل حتى يحدّث الطلب إلى `processing` ويرسل notification للـ origin sales agent والـ assigned/current underwriter بدون اعتماد على فتح dashboard.
- جعل patch idempotent وآمن لإعادة التشغيل.

5. التحقق
- بعد التنفيذ: تسجيل دخول كـ supervisor، تعديل sales agent، تعيين underwriter من نفس الفرع، ثم رفع مستند من رابط العميل والتأكد أن الطلب يظهر/يتحدث بدون refresh.