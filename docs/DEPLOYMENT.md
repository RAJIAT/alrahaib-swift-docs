# دليل النشر — Al Diplomacy Insurance Services Portal

> **الهدف:** نشر تطبيق TanStack Start على DirectAdmin عبر Node.js + PM2 خلف Apache reverse proxy، والاعتماد على Directus self-hosted كـ backend.

---

## 1. البنية بعد النشر

```
المتصفح (HTTPS)
   │
   ▼
Apache (DirectAdmin) ──/uploads/──► ملفات Directus (static)
   │ (reverse proxy)
   ▼
Node 20 + PM2  (127.0.0.1:3000)        ← تطبيق TanStack Start (SSR)
   │ HTTPS REST
   ▼
Directus + Postgres (نفس السيرفر، :8055)
```

- **Frontend/SSR:** TanStack Start يُبنى لـ Node target ويعمل عبر PM2.
- **Backend:** Directus self-hosted (مستقل، له `.env` خاص به).
- **DB:** Postgres داخل نفس السيرفر يديره Directus.
- **File storage:** مجلد `/uploads` التابع لـ Directus.

---

## 2. متطلبات السيرفر (تثبَّت مرة واحدة)

| المتطلب | الإصدار | ملاحظات |
|---|---|---|
| Node.js | 20.x LTS | عبر **Node.js Selector** في DirectAdmin |
| bun | ≥ 1.1 | `curl -fsSL https://bun.sh/install \| bash` |
| PM2 | latest | `npm i -g pm2` |
| Apache | مع mod_proxy + mod_proxy_http + mod_headers + mod_rewrite | فعّل من DirectAdmin |
| Directus | latest | راجع `DIRECTUS_SETUP.md` |
| Postgres | ≥ 14 | يديره Directus |
| Certbot / AutoSSL | — | لإصدار شهادة Let's Encrypt |

---

## 3. ترتيب النشر (بعد توفر SSH)

### 3.1 تجهيز الكود محلياً (أو على CI)

```bash
# 1. ثبّت الـ deps
bun install

# 2. ابنِ نسخة الإنتاج (target = Node)
bun run build

# الناتج:
#   .output/         ← السيرفر (SSR + assets)
#   .output/server/index.mjs  ← نقطة الدخول
```

### 3.2 رفع الملفات للسيرفر

ارفع (عبر SFTP / rsync) إلى `/home/<user>/apps/aldiplomacy-portal/`:

```
.output/
public/
package.json
bun.lockb
ecosystem.config.cjs
.env                ← انسخه من .env.example واملأ القيم
scripts/            ← للـ bootstrap (اختياري)
```

مثال rsync:

```bash
rsync -avz --delete \
  .output public package.json bun.lockb ecosystem.config.cjs scripts \
  user@server:/home/user/apps/aldiplomacy-portal/
```

### 3.3 إعداد متغيرات البيئة

```bash
ssh user@server
cd ~/apps/aldiplomacy-portal
cp .env.example .env
nano .env                       # املأ VITE_APP_URL, VITE_DIRECTUS_URL, SESSION_SECRET, ...
chmod 600 .env                  # مهم: حماية السر
mkdir -p logs uploads
chmod 755 uploads
```

### 3.4 تثبيت runtime deps (إن لزم)

```bash
bun install --production
```

> الـ `.output/` يحوي bundle مكتمل، لكن بعض الـ native deps قد تحتاج install على السيرفر.

### 3.5 تشغيل Directus (مرة واحدة)

راجع `DIRECTUS_SETUP.md`. باختصار:
- شغّل Postgres.
- ثبّت Directus عبر npm/Docker.
- اضبط `.env` الخاص بـ Directus (DATABASE_URL, ADMIN_EMAIL, ADMIN_PASSWORD, STORAGE_LOCATIONS, EMAIL_*).
- شغّل migrations + admin user.

ثم طبّق الـ collections والـ permissions:

```bash
cd ~/apps/aldiplomacy-portal
export DIRECTUS_URL=http://10.8.0.21:8080
export DIRECTUS_ADMIN_TOKEN=<من Directus admin>
npx tsx scripts/directus-bootstrap.ts
```

### 3.6 تشغيل التطبيق عبر PM2

```bash
cd ~/apps/aldiplomacy-portal
pm2 start ecosystem.config.cjs --env production
pm2 save
pm2 startup            # انفّذ الأمر اللي يطبعه pm2 (مرة وحدة)
pm2 logs aldiplomacy-portal --lines 50
```

تأكد:
```bash
curl -I http://127.0.0.1:3000/
# يجب أن يرجّع 200 أو 302 (redirect للـ login)
```

### 3.7 ربط الدومين عبر Apache

1. من DirectAdmin → **Domain Setup** أضف الدومين `10.8.0.21`.
2. ضع ملف `deploy/.htaccess` (الموجود في هذا الـ repo) داخل `public_html/`:
   ```bash
   cp ~/apps/aldiplomacy-portal/deploy/.htaccess ~/domains/10.8.0.21/public_html/
   ```
3. تأكد أن `mod_proxy` و `mod_proxy_http` و `mod_headers` مفعّلة (DirectAdmin → Custom HTTPD Configurations).
4. أصدر شهادة SSL:
   - DirectAdmin → **SSL Certificates** → Let's Encrypt → اختر الدومين → Save.

### 3.8 التحقق النهائي

```bash
curl -I http://10.8.0.21/
curl -I http://10.8.0.21/login
curl -I http://10.8.0.21:8080/server/info
```

---

## 4. التحديثات اللاحقة (deploy جديد)

```bash
# محلياً
bun run build
rsync -avz --delete .output public package.json bun.lockb \
  user@server:/home/user/apps/aldiplomacy-portal/

# على السيرفر
ssh user@server "cd ~/apps/aldiplomacy-portal && pm2 reload aldiplomacy-portal"
```

`pm2 reload` يعمل zero-downtime restart.

---

## 5. مواقع مهمة على السيرفر

| المسار | المحتوى |
|---|---|
| `~/apps/aldiplomacy-portal/` | كود التطبيق |
| `~/apps/aldiplomacy-portal/.env` | متغيرات البيئة (chmod 600) |
| `~/apps/aldiplomacy-portal/logs/` | logs PM2 |
| `~/apps/aldiplomacy-portal/uploads/` | (احتياطي) — الأساس عند Directus |
| `~/directus/uploads/` | ملفات Directus |
| `~/domains/10.8.0.21/public_html/.htaccess` | reverse proxy rules |

---

## 6. استكشاف الأخطاء

| الخطأ | الحل |
|---|---|
| 502 Bad Gateway | تأكد `pm2 status` يُظهر التطبيق `online`، وأن `mod_proxy_http` مفعّل |
| `EADDRINUSE :3000` | بورت محجوز — غيّر `PORT` في `.env` و`ecosystem.config.cjs` |
| Mixed content على `/api/...` | تأكد أن Directus يُخدم على HTTPS (نفس origin أو CORS مضبوط) |
| 403 على `/uploads/...` | صلاحيات المجلد — `chmod 755 uploads` و owner = user الـ Apache |
| login يرجّع 401 | راجع `VITE_DIRECTUS_URL` في `.env` + permissions Directus |

---

راجع أيضاً: `CHECKLIST.md` لقائمة جاهزية النشر الكاملة.