## التشخيص النهائي

البيانات في الـ backend سليمة تماماً:
- المستخدم Reda موجود مع `agent_id = "A21"` و role = Agent.
- 3 طلبات موجودة كلها مربوطة بـ `agent_id = "A21"`.

لكن دashboard الايجنت فاضي. السبب: filter القراءة على collection `requests` صار:
```
agent_id = $CURRENT_USER.agent_id
```
ولكي ينجح هذا الفلتر، Directus يحتاج لقراءة قيمة `agent_id` من جدول `directus_users` لحساب المستخدم الحالي. صلاحية `Agent.directus_users.read` موجودة فعلاً، **لكن الحقول المسموح قراءتها محدودة وغالباً لا تتضمن الحقل المخصص `agent_id`** (وكذلك `branch`). النتيجة: `$CURRENT_USER.agent_id` يُحسب كـ `null` → الفلتر يصير `agent_id = null` → 0 نتائج.

نفس المشكلة ستظهر للمشرف لاحقاً مع `$CURRENT_USER.branch`.

## الإصلاح

تحديث `src/routes/api/directus.$.ts` داخل `runDirectusMaintenance()` ليضمن:

1. **Agent policy** عنده permission `directus_users.read` يشمل صراحةً الحقول:
   `id, first_name, last_name, email, role, agent_id, branch, supervisor_id, status`
   
   مع فلتر صف: `id = $CURRENT_USER.id` (الايجنت يقرأ نفسه فقط، ليس باقي المستخدمين).

2. **Supervisor policy** عنده نفس permission على `directus_users.read` يشمل الحقول أعلاه، مع فلتر:
   `_or: [ { id: $CURRENT_USER.id }, { branch: $CURRENT_USER.branch }, { supervisor_id: $CURRENT_USER.id } ]`

3. استخدام `upsertPermission` (الموجودة سابقاً) لإعادة الكتابة فوق أي permission قديم محدود.

4. زيادة رقم نسخة الـ maintenance state إلى `__aibDirectusMaintenance_v3` لإجبار إعادة التشغيل بعد النشر.

## التحقق بعد النشر

- الانتظار دقيقة، فتح أي صفحة تحت `/api/directus/*` ليعمل الـ maintenance.
- تسجيل دخول Reda → داشبورد الايجنت يجب أن يظهر الطلبات الـ3.
- إذا لم تظهر، نضيف log في `proxy()` عند GET `/items/requests` ليطبع status الرد من Directus لتحديد بقية المشكلة بدقة.

## ملاحظة أمنية

السماح للايجنت بقراءة `id, branch, agent_id, supervisor_id` لحسابه الشخصي فقط آمن. لا يكشف بيانات وكلاء آخرين.
