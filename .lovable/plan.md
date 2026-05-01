## التحقق من حالة Directus على السيرفر

أنشئ endpoint تشخيصي `/api/diag` (server route) يستخدم `DIRECTUS_ADMIN_TOKEN` المحفوظ كـ secret للاتصال المباشر بـ Directus وإرجاع تقرير شامل.

### ما سيرجعه التقرير:

1. **Collections** — قائمة بكل الجداول الموجودة (ما عدا الـ system tables)
2. **Record counts** — عدد السجلات في كل جدول (requests, branches, audit_log, request_notes, request_attachments, request_missing_attachments, request_vehicle_media)
3. **Users** — مجمّعين حسب الدور:
   - Administrators (إيميلات + حالة + الفرع)
   - Supervisors (إيميلات + حالة + الفرع)
   - Agents (إيميلات + حالة + الفرع)
4. **Roles** — الأدوار المعرّفة
5. **Branches** — الفروع الموجودة
6. **Permissions by role** — أي جدول/إجراء مسموح لأي دور
7. **مقارنة** بين الـ collections الموجودة والـ collections المتوقعة

### بعد الإنشاء:

سأشغّله مباشرة عبر `stack_modern--invoke-server-function` أو `curl` عبر الـ preview URL، وأعطيك ملخص واضح:
- ✅ ما الموجود وصحيح
- ⚠️ ما الناقص أو فيه مشكلة
- 📊 الأرقام (كم admin، كم agent، كم طلب، إلخ)

### ملف واحد فقط:
- `src/routes/api/diag.ts` (~80 سطر)

بدون لمس أي ملف آخر. آمن للترك في الكود — يتطلب admin token (إذا التوكن غير مضبوط، يرد بخطأ واضح بدون كشف معلومات).
