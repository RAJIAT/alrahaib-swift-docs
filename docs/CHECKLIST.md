# قائمة جاهزية النشر — Al Diplomacy Insurance Services Portal

> آخر تحديث: 2026-06-10

---

## ✅ تم في الكود (Done)

- [x] إزالة `wrangler.jsonc` وتحويل البناء من Cloudflare Workers إلى **Node.js target** (`cloudflare: false` في `vite.config.ts`).
- [x] إضافة `npm script` للتشغيل: `npm run start` → `node .output/server/index.mjs`.
- [x] إعداد PM2 جاهز: `ecosystem.config.cjs`.
- [x] قالب Apache reverse proxy: `deploy/.htaccess`.
- [x] تحديث `.env.example` بكل متغيرات الفرونت والـ Node runtime (مع توضيح أن `DATABASE_URL` و`SMTP_*` تخص Directus).
- [x] إزالة `console.warn` غير المحمي (الباقي مُغلَّف بـ `import.meta.env.DEV`).
- [x] وثائق نشر كاملة بالعربية: `docs/DEPLOYMENT.md`.
- [x] hardcoded URLs: لا يوجد أي `http://localhost` أو IP في كود الإنتاج. كل المسارات تعتمد env.
- [x] error boundary على مستوى الـ router موجود، و dev-only stack trace خلف `import.meta.env.DEV`.

---

## ⚠️ متبقّي — يحتاج جلسة عمل إضافية (يفضّل قبل النشر)

- [ ] **استكمال Directus integration (المرحلة 3 من الخطة).**
  - `src/services/api.ts` ما زال يستهلك `demoStore` (in-memory/localStorage).
  - `src/services/directusClient.ts` موجود لكن لا يُستخدم.
  - لازم إعادة كتابة `api.ts` ليستهلك Directus عبر `directusClient`، وتغطية: requests, quotes, users, branches, roles, attachments, chat.
- [ ] **حذف `demoStore.ts` و `DemoBanner` ومراجع `Fill demo data`** بعد ربط Directus (لا يُحذف قبل لأن التطبيق يعتمد عليه).
- [ ] **حذف ملفات Lovable Cloud/Supabase غير المستخدمة:** `src/integrations/supabase/*` و dep `@supabase/supabase-js`. (آمن — لا يستوردها كود التطبيق، لكن تركتها لتفادي تعارض ملفات auto-managed.)
- [ ] **تثبيت Directus collections + permissions على السيرفر** عبر `scripts/directus-bootstrap.ts`.
- [ ] **اختبار QA كامل** لكل دور: Super Admin, Supervisor, Subscriber, Agent — تسجيل دخول، فلترة فرع، صلاحيات Quote، رفع ملفات.

---

## ⚙️ يتطلب وصول السيرفر فقط (Server-side only)

- [ ] إنشاء SSH user و SFTP credentials في DirectAdmin.
- [ ] تثبيت Node 20 LTS عبر **Node.js Selector** في DirectAdmin.
- [ ] تثبيت `pm2` عالمياً (`npm i -g pm2`).
- [ ] تفعيل Apache modules: `mod_proxy`, `mod_proxy_http`, `mod_headers`, `mod_rewrite` (Custom HTTPD Configurations).
- [ ] تثبيت Postgres + Directus (راجع `DIRECTUS_SETUP.md`).
- [ ] ضبط DNS:
  - `10.8.0.21` → IP السيرفر (A record)
  - `10.8.0.21:8080` → نفس IP السيرفر (A record)
- [ ] إصدار شهادات SSL لكلا الدومينين (DirectAdmin → SSL → Let's Encrypt).
- [ ] إنشاء `.env` على السيرفر بالقيم الإنتاجية + `chmod 600 .env`.
- [ ] إعداد `EMAIL_*` في `.env` الخاص بـ Directus (SMTP فعلي).
- [ ] جدولة backup يومي لـ Postgres وللـ `/uploads` (cron أو DirectAdmin backups).

---

## 📦 خطوات النشر بعد توفر SSH (Quick run)

```bash
# 1) محلياً
npm ci
npm run build
rsync -avz --delete \
  .output public package.json package-lock.json ecosystem.config.cjs scripts deploy \
  user@server:/home/user/apps/aldiplomacy-portal/

# 2) على السيرفر
ssh user@server
cd ~/apps/aldiplomacy-portal
cp .env.example .env && nano .env && chmod 600 .env
mkdir -p logs

# Directus bootstrap (مرة واحدة)
DIRECTUS_URL=http://10.8.0.21:8080 \
DIRECTUS_ADMIN_TOKEN=xxxxxxxx \
npx tsx scripts/directus-bootstrap.ts

# تشغيل التطبيق
pm2 start ecosystem.config.cjs --env production
pm2 save && pm2 startup

# 3) Apache
cp deploy/.htaccess ~/domains/10.8.0.21/public_html/.htaccess
# ثم: DirectAdmin → SSL → Let's Encrypt لكلا الدومينين
```

---

## 🔧 إعدادات DirectAdmin

1. **Domain Setup** → أضف `10.8.0.21` و `10.8.0.21:8080`.
2. **Node.js Selector** → اختر Node 20، اضبط Application Root = `~/apps/aldiplomacy-portal`، Application URL = `10.8.0.21`، Startup File = `.output/server/index.mjs` (أو اعتمد على PM2 وعطّل Node Selector).
3. **Custom HTTPD Configurations** → فعّل `mod_proxy`, `mod_proxy_http`, `mod_headers`, `mod_rewrite`.
4. **SSL Certificates** → Let's Encrypt → اختر الدومينين → Save.
5. **Cron Jobs** → أضف backup يومي لـ Postgres.
6. **File Manager / SSH** → ارفع المشروع لـ `~/apps/aldiplomacy-portal/`.

---

## 🗄 أوامر Directus (Bootstrap + Migration)

```bash
# على السيرفر، بعد تثبيت Directus وإنشاء admin user
cd ~/apps/aldiplomacy-portal

# ولّد admin token من Directus → Settings → Access Tokens
export DIRECTUS_URL=http://10.8.0.21:8080
export DIRECTUS_ADMIN_TOKEN=<token>

# طبّق الـ collections (idempotent، آمن للإعادة)
npx tsx scripts/directus-bootstrap.ts

# (اختياري) بيانات seed أولية
npx tsx scripts/directus-seed.ts
```

تفاصيل الـ schema في `docs/directus-schema.md` و `scripts/directus-permissions.json`.

---

## 🔒 Audit أمان نهائي

- [x] لا يوجد `dangerouslySetInnerHTML` على input مستخدم.
- [x] لا hardcoded credentials في الكود.
- [x] جميع `.env` keys حساسة بدون `VITE_` prefix.
- [x] `.gitignore` يستثني `.env` و `logs/` و `.output/`.
- [ ] **بعد ربط Directus:** فحص أن كل route يتحقق من الـ role قبل العرض.
- [ ] **بعد ربط Directus:** تشغيل security scan وإصلاح أي Critical/High.

---

## 🚀 تأكيد الجاهزية النهائية (بعد go-live)

- [ ] `http://10.8.0.21/` يفتح صفحة login.
- [ ] تسجيل دخول Admin يعمل.
- [ ] إنشاء request + رفع ملف يعمل.
- [ ] الـ logs نظيفة (`pm2 logs`).
- [ ] الـ SSL Grade A على https://www.ssllabs.com/ssltest/.
- [ ] استجابة < 500ms للـ TTFB.
- [ ] backup يومي يعمل (تحقق بعد 24h).

---

## ملخص "ماذا فعلت Lovable الآن، وماذا متبقّي"

| القسم | الحالة |
|---|---|
| Production build target (Node) | ✅ جاهز |
| PM2 + Apache reverse proxy artifacts | ✅ جاهز |
| .env template كامل | ✅ جاهز |
| Deployment runbook بالعربية | ✅ جاهز |
| إزالة Cloudflare Workers config | ✅ تم |
| تنظيف console.* | ✅ تم |
| **Directus integration (api.ts)** | ⚠️ متبقّي — جلسة منفصلة |
| **حذف demoStore** | ⚠️ مرتبط بالنقطة أعلاه |
| SSH/DNS/SSL/Directus install | ⚠️ بعد فتح وصول السيرفر |