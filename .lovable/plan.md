## خطة الإنهاء النهائي لـ Directus Backend

سأقوم بتنفيذ كل الإصلاحات المتبقية دفعة واحدة عبر Directus Admin API (باستخدام static admin token الموجود في proxy):

### 1. إصلاح صلاحيات الأدوار (Permissions)
- **Agent**: إضافة `create` على `audit_log` + `read/create` على `request_missing_attachments`
- **Supervisor**: التأكد من صلاحيات الفرع الكاملة
- **Public**: تشديد الوصول على `requests` (قراءة فقط بـ ID محدد، بدون list)

### 2. تنظيف الـ Schema
- حذف collection القديم `agents` (لم يعد مستخدماً، تم استبداله بـ directus_users)
- حذف collection القديم `requests_files` (تم استبداله بـ `request_attachments`)

### 3. إنشاء مستخدمين تجريبيين
- `supervisor@alrahaib.com` / دور Supervisor / مرتبط بفرع رئيسي
- `agent@alrahaib.com` / دور Agent / مرتبط بفرع رئيسي
- كلمات سر مؤقتة قوية (سأعرضها لك بعد الإنشاء)

### 4. التحقق النهائي (Smoke Test)
- تسجيل دخول كل دور والتأكد من:
  - Admin → يرى كل الطلبات + Branches + Agents + Audit
  - Supervisor → يرى طلبات فرعه فقط
  - Agent → ينشئ طلبات تظهر تحت فرعه
- فحص أن audit_log يستقبل الأحداث

### 5. تجهيز ملف توثيق النشر
إنشاء `docs/DEPLOYMENT.md` يحتوي:
- بيانات السيرفر (74.162.122.193)
- خطوات بناء الـ frontend (`npm run build`)
- إعدادات Nginx جاهزة (reverse proxy لـ Directus + static files)
- خطوات Let's Encrypt (للتنفيذ لاحقاً عند ربط الدومين)
- متغيرات البيئة المطلوبة

### ما لن أعمله (حسب طلبك)
- ❌ ربط الدومين `docportal.alrahaib.com`
- ❌ إصدار شهادة SSL
- ❌ نقل الـ frontend فعلياً للسيرفر

كل شي تاني بكون جاهز 100% للضغط على زر النشر فقط.
