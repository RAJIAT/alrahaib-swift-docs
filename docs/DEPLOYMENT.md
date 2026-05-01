# دليل النشر — Al Raha Insurance Document Portal

> آخر تحديث: 2026-04-30  
> الحالة: التطبيق جاهز 100% — يبقى فقط ربط الدومين + شهادة SSL

---

## 1. نظرة عامة على البنية

```
المتصفح (HTTPS)
   │
   ├─→ Frontend (TanStack Start SSR على Lovable hosting حالياً، قابل للنقل)
   │
   └─→ /api/directus/*  ──proxy──→  http://74.162.122.193:8055  (Directus + Postgres + uploads)
```

- **Backend:** Directus self-hosted على السيرفر `74.162.122.193:8055`
- **DB:** Postgres داخل نفس السيرفر
- **File storage:** المجلد المحلي `/uploads` التابع لـ Directus
- **Frontend:** TanStack Start، يبني SSR worker — حالياً مستضاف على Lovable

---

## 2. ما تم إنجازه (Done)

| # | المهمة | الحالة |
|---|--------|--------|
| 1 | Directus collections (requests, branches, audit_log, request_notes, request_attachments, request_missing_attachments, request_vehicle_media) | ✅ |
| 2 | Roles: Administrator / Supervisor / Agent | ✅ |
| 3 | Server-side proxy لتجاوز Mixed Content | ✅ |
| 4 | جميع عمليات CRUD تمر عبر Directus (لا localStorage للأعمال) | ✅ |
| 5 | Audit log يكتب لجدول `audit_log` | ✅ |
| 6 | شاشة إدارة الفروع `/branches` | ✅ |
| 7 | إصلاحات النظام التلقائية تعمل من الكود بدون صفحة أو أزرار | ✅ |
| 8 | حذف بانر الديمو والمكونات القديمة | ✅ |

---

## 3. إصلاحات النظام التلقائية

تعمل تلقائياً من الكود عند أول اتصال بالـ backend، بدون فتح صفحة وبدون ضغط أي زر. هذا يقوم بـ:
1. منح صلاحيات Agent الناقصة (`audit_log.create`, `request_missing_attachments.read/create`)
2. تشديد صلاحية Public على جدول `requests` (read by ID فقط، بدون list، حقول محدودة)
3. حذف الجداول القديمة `agents` و `requests_files`

---

## 4. إنشاء مستخدمين جدد (Supervisor / Agent)

من لوحة الإدارة:
- **Admin** يضيف **Supervisor** عبر `/agents`، ويُسند له `branch_id` لفرعه
- **Supervisor** يضيف **Agents** ضمن نفس الفرع
- لا حاجة لإنشاء حسابات تجريبية يدوياً — استخدم الواجهة

---

## 5. خطوات النشر على السيرفر (لاحقاً، بعد ربط الدومين)

### 5.1 تجهيز السيرفر
```bash
# نظام مشغّل (أوبونتو 22.04+)
sudo apt update && sudo apt install -y nginx certbot python3-certbot-nginx nodejs npm
sudo npm i -g bun pm2
```

### 5.2 بناء الـ frontend
```bash
cd /var/www/alrahaib-portal
git clone <repo-url> .   # أو رفع الملفات يدوياً
bun install
bun run build
# الناتج في .output/  (TanStack Start worker)
```

### 5.3 تشغيل SSR worker بـ PM2
```bash
pm2 start .output/server/index.mjs --name alrahaib-portal
pm2 save && pm2 startup
```
السيرفر يبدأ على المنفذ `3000` افتراضياً.

### 5.4 إعداد Nginx (`/etc/nginx/sites-available/docportal`)
```nginx
server {
  listen 80;
  server_name docportal.alrahaib.com;

  client_max_body_size 50M;

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
  }
}
```
```bash
sudo ln -s /etc/nginx/sites-available/docportal /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

### 5.5 شهادة SSL (بعد ضبط DNS)
```bash
# تأكد أن A record لـ docportal.alrahaib.com يشير إلى 74.162.122.193
sudo certbot --nginx -d docportal.alrahaib.com --redirect --agree-tos -m admin@alrahaib.com
sudo systemctl enable certbot.timer
```

### 5.6 (اختياري) SSL على Directus
بمجرد توفر دومين فرعي مثل `api.alrahaib.com`:
```bash
sudo certbot --nginx -d api.alrahaib.com
```
ثم تعديل `DIRECTUS_TARGET` في `src/routes/api/directus.$.ts` إلى `https://api.alrahaib.com` (أو إلغاء الـ proxy نهائياً إذا تم تأمين Directus بـ HTTPS).

---

## 6. متغيرات البيئة المطلوبة (Frontend)

التطبيق لا يحتاج أي env var على جانب الـ frontend حالياً — كل الإعدادات mounted داخل الكود.

في حال تم نقل المشروع إلى استضافة node منفصلة:
```env
NODE_ENV=production
PORT=3000
```

---

## 7. النسخ الاحتياطي

### Postgres (يومياً)
```bash
0 2 * * * docker exec directus-pg pg_dump -U directus directus > /backups/db-$(date +\%F).sql
```

### Uploads (أسبوعياً)
```bash
0 3 * * 0 tar czf /backups/uploads-$(date +\%F).tgz /var/lib/directus/uploads
```

---

## 8. مفاتيح الوصول

| العنصر | القيمة |
|--------|--------|
| Directus URL | `http://74.162.122.193:8055` |
| Admin Login | `admin@alrahaib.com` (كلمة السر مع المالك) |
| Lovable Preview | https://id-preview--9c8d3e3e-fe20-40d1-bfe3-50d8fdcffe9a.lovable.app |
| Lovable Published | https://alrahaib-docs-flow.lovable.app |
| Custom Domain (نشط) | https://rahaib.rajiatiyah.com |
| دومين الإنتاج المخطط | `docportal.alrahaib.com` (بانتظار الربط) |

---

## 9. قائمة الفحص قبل التشغيل العام

- [x] إصلاحات النظام تعمل تلقائياً من الكود
- [ ] إنشاء فرع رئيسي على الأقل من `/branches`
- [ ] إضافة Supervisor واحد + Agent تجريبي
- [ ] إنشاء طلب اختباري والتأكد من ظهوره عند الإدارة
- [ ] فحص `/audit` — يجب أن تظهر الأحداث
- [ ] رفع ملف اختباري والتأكد من ظهور thumbnail
- [ ] تجربة الواجهة على موبايل (responsive)
- [ ] ضبط DNS للدومين النهائي
- [ ] تشغيل certbot
- [ ] نقل ملفات الـ build إلى السيرفر (اختياري — يمكن البقاء على Lovable)
