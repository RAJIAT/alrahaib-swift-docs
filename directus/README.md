# Directus Setup — One Script

## التشغيل (3 خطوات)

```bash
cd directus
chmod +x setup.sh
./setup.sh
```

السكربت بستخدم الـ Static Token اللي عطيتني:
- URL: `http://74.162.122.193:8055`
- Token: `Ku-owyi9r8CzuyI8SlIHTqPD2Yu04OKp`

## شو بعمل السكربت؟

✅ ينشئ collection **`requests`** مع:
- `id` (UUID auto, PK)
- `date_created` (auto)
- `status` (dropdown: new / processing / reupload / sold / rejected)
- `agent_id`, `agent_name`, `branch`
- `customer_name`, `customer_email`, `customer_phone`
- `registration`, `license`, `emirates`, `passport` (M2O → files)
- `vehicle_photos` (M2M → files)
- `missing_attachments` (للنواقص)

✅ ينشئ junction `requests_files` للـ M2M

✅ يضيف على `directus_users` حقول: `agent_id`, `branch`

✅ ينشئ **Public Policy** بصلاحيات:
- إنشاء files + إنشاء requests
- تحديث `missing_attachments` والملفات فقط (للعميل لما يرجع يرفع نواقص)

✅ ينشئ أدوار **Agent** و **Supervisor** فاضية (تربطهم policies من الـ UI حسب احتياجك)

## بعد التشغيل

1. افتح `http://74.162.122.193:8055/admin`
2. Settings → Roles → **Agent** → أضف فلتر RLS:
   ```json
   { "agent_id": { "_eq": "$CURRENT_USER.agent_id" } }
   ```
3. أنشئ أول Agent من Users (أو من شاشة `/agents` بالفرونت لما تشغل المنصة)
4. بالفرونت، حط بـ `.env`:
   ```
   VITE_DIRECTUS_URL=http://74.162.122.193:8055
   ```

## ملاحظات مهمة

- **الـ Token اللي عطيتني هو Admin static token** — السكربت بنفّذ كل شي مباشرة بدونه login.
- لو ضيّعت الـ Token، رجاع لـ Directus → Users → Admin → Token وعمل واحد جديد.
- السكربت **idempotent**: تقدر تشغّله أكتر من مرة بدون ما يكسر شي (الموجود بتجاهلو).
