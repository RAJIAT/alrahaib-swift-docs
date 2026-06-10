
# خطة ما قبل النشر على DirectAdmin

## ملاحظات حاسمة لازم تعرفها قبل ما نبدأ

1. **التطبيق حالياً مبني على Cloudflare Workers** (`@cloudflare/vite-plugin`, `wrangler.jsonc`, `@tanstack/react-start/server-entry`). DirectAdmin ما بشغّل Workers، فلازم نحوّل الـ build target لـ **Node.js** ونشغّله عبر **PM2 (الأفضل) أو Passenger** خلف Apache/Nginx reverse proxy.
2. **الـ data layer الحقيقي اليوم هو `demoStore` (in-memory)**، مش Supabase ومش Directus. ملف `directusClient.ts` stub معطّل، و`services/api.ts` كله يقرأ من demoStore. يعني "النقل لـ Directus" مش تنظيف — هو **بناء integration كامل** (auth + collections + permissions + storage + queries) ونقل كل صفحة لتستهلكه.
3. **Supabase integration files موجودة في `src/integrations/supabase/*` لكن مش مستخدمة من كود التطبيق** (فقط ملفات Lovable التلقائية). لازم نحييدها قبل ما نشيل Lovable Cloud كلياً، لأن إيقافها من غير ما نشيل الملفات بيكسر الـ SSR build.
4. **هذا شغل كبير وما بنخلصه بضربة وحدة.** بنقسمه لمراحل، وأنا بحذرك أي بند لا يمكن إتمامه بدون الوصول للسيرفر.

---

## المرحلة 1 — تنظيف الكود وإزالة كل ما هو تجريبي

- حذف `demoStore` وكل ما يعتمد عليه (DemoBanner، زر Fill demo data، الحسابات التجريبية، الـ seed JSONs داخل الكود).
- إزالة 10 console.* المتبقية (نبقي `console.error` فقط داخل error boundaries).
- حذف Supabase: `src/integrations/supabase/*`، `@supabase/supabase-js` من `package.json`، أي `.env` keys خاصة بـ Supabase، وذكرها من الوثائق.
- حذف ملف `wrangler.jsonc` و`@cloudflare/vite-plugin` من dependencies.
- مراجعة كل `import.meta.env.DEV` checks للتأكد أنها بتختفي فعلاً في production.

## المرحلة 2 — تحويل الـ build لـ Node.js target

- استبدال `@lovable.dev/vite-tanstack-config` بإعداد Vite صريح للـ Node target مع TanStack Start (`target: "node-server"`).
- إضافة سكربتات `package.json`: `build:prod`, `start` (يشغّل `node .output/server/index.mjs`)، `start:pm2`.
- إضافة ملف `ecosystem.config.cjs` لـ PM2 (اسم العملية، البورت، env file، logs path، restart policy).
- التأكد من أن server functions/SSR تعمل تحت Node (إزالة أي اعتماد على Workers APIs).
- توليد build محلي والتحقق من `dist/` و`.output/` ومن أن `node .output/server/index.mjs` يستجيب.

## المرحلة 3 — استكمال Directus integration وجعله الـ source of truth الوحيد

هذا هو البند الأكبر زمنياً. الترتيب:

1. تنفيذ كامل `directusClient.ts` (auth, refresh, request, file upload, error normalization).
2. كتابة طبقة `services/api.ts` جديدة تستهلك Directus بدلاً من demoStore، تغطي: requests، quotes، users، branches، roles، attachments، chat threads/messages.
3. تنفيذ نظام الصلاحيات (Super Admin / Supervisor / Subscriber / Agent) كـ:
   - أدوار Directus + policies (في `scripts/directus-permissions.json`).
   - middleware في الـ client يتحقق من الـ role قبل عرض الصفحة (route guard).
   - فلترة على مستوى الـ collection (branch isolation, quote ownership).
4. الاعتماد على Directus Files لرفع الملفات (مع validation: MIME, size, magic bytes).
5. حذف `scripts/directus-seed.ts` المكرر أو تثبيته كأداة seed اختيارية production-safe (idempotent، لا يكتب فوق بيانات موجودة).

> **ملاحظة:** كل migrations Directus = collections JSON تُطبّق عبر `scripts/directus-bootstrap.ts`. لا توجد SQL migrations يدوية، Directus بيدير الـ schema.

## المرحلة 4 — Environment variables و runtime config

تحديث `.env.example` بالضبط لما يحتاجه الفرونت + سكربتات الـ bootstrap:

```bash
# Frontend (Vite)
VITE_DIRECTUS_URL=https://directus.alrahaib.com
VITE_APP_URL=https://docportal.alrahaib.com
VITE_PUBLIC_UPLOAD_BASE=/uploads   # relative path served by Directus/Apache

# Node server runtime
PORT=3000
NODE_ENV=production
SESSION_SECRET=<32+ chars random>

# Bootstrap/admin scripts فقط (مش للفرونت)
DIRECTUS_URL=https://directus.alrahaib.com
DIRECTUS_ADMIN_TOKEN=
```

ملاحظات صريحة في الوثائق:
- `DATABASE_URL` و `SMTP_*` و `STORAGE_PATH` تخص خادم Directus نفسه، **مش الفرونت**. تُضبط في `.env` الخاص بـ Directus داخل DirectAdmin، وليس في هذا المشروع.
- التأكد من أن جميع المسارات في الكود نسبية (لا hardcoded `https://...` خارج env).

## المرحلة 5 — أمان وتحقق المدخلات

- مراجعة كل form للتأكد من Zod schema (max length، email format، file types).
- منع XSS: التأكد من عدم وجود `dangerouslySetInnerHTML` على مدخلات مستخدم.
- تأكيد أن كل route محمي بـ guard على مستوى الـ client + إعادة فحص الصلاحية مع كل request لـ Directus.
- تشغيل security scan كامل وإصلاح أي finding من Critical/High.
- إزالة أي مسار admin مخفي أو bypass.

## المرحلة 6 — أداء وتحسينات

- التأكد من lazy loading للـ routes الثقيلة (تطبيق `tanstack-code-splitting`).
- مراجعة الصور: تحويل للـ `lovable-assets` أو ضغط webp.
- استخدام TanStack Query مع loaders بدل `useEffect+fetch`.
- إزالة re-renders زائدة (memoization حيث يلزم فقط بعد قياس).

## المرحلة 7 — حزمة DirectAdmin deployment

إنشاء `docs/DEPLOYMENT.md` (تحديث الموجود) و`docs/CHECKLIST.md` يحتوي:

- خطوات بناء الإصدار: `bun install`، `bun run build`، رفع `.output/` و`public/` و`package.json` و`bun.lockb`.
- إعداد Node.js Selector في DirectAdmin (الإصدار، startup file، Application URL).
- ملف PM2 الجاهز + أوامر `pm2 start ecosystem.config.cjs && pm2 save && pm2 startup`.
- ملف `.htaccess` reverse proxy لـ Apache (إن لزم) — جاهز للنسخ.
- مسار رفع متغيرات البيئة على السيرفر (مكان `.env` وصلاحياته `600`).
- خطوات تثبيت/ترقية Directus على نفس السيرفر (مرجع لـ `DIRECTUS_SETUP.md`).
- أمر `bun run scripts/directus-bootstrap.ts` لإنشاء الـ collections والـ permissions.
- ترتيب التطبيق: (1) رفع الكود → (2) `bun install --production` → (3) build → (4) ضبط env → (5) bootstrap Directus → (6) `pm2 start` → (7) ربط الدومين/SSL.

## المرحلة 8 — التسليم النهائي (Checklist)

ملف `docs/CHECKLIST.md` بالأقسام التي طلبتها:

- ✅ ما تم في الكود.
- ⚠️ ما يحتاج صلاحيات السيرفر فقط (SSL، DNS، إعدادات DirectAdmin، تثبيت Node/PM2، تشغيل Directus، رفع `.env`).
- 📦 خطوات النشر بعد توفر SSH.
- 🔧 إعدادات DirectAdmin الدقيقة.
- 🗄 أوامر Directus bootstrap وterms migration.
- 🚀 اختبارات قبول نهائية بعد go-live.

---

## ما **لن** يُنفَّذ ضمن هذه الخطة (بصراحة)

- لا يمكنني SSH للسيرفر، تثبيت Node/PM2، رفع DNS، أو تشغيل بناء حقيقي على بيئة DirectAdmin من هنا.
- لا يمكنني فحص الأداء الحقيقي تحت حِمل production — فقط تحسينات كود.
- "QA كاملة لكل صفحة" بنغطيها عبر فحوصات تلقائية (build, lint, type-check) + جولة UI على الـ preview، لكن اختبار سلوكي شامل يحتاج بيانات حقيقية من Directus.

---

## ترتيب التنفيذ المقترح (لتقليل المخاطر)

1. المرحلة 1 (تنظيف) — تغيير ميكانيكي آمن.
2. المرحلة 2 (Node target) — بدونها لا يوجد deployable artifact.
3. المرحلة 3 (Directus integration) — أكبر مرحلة، قد تحتاج عدة جلسات.
4. المراحل 4–6 بالتوازي مع 3.
5. المرحلة 7–8 (deployment package + checklist) في النهاية.

---

## سؤال قبل الموافقة

المرحلة 3 (نقل كامل لـ Directus) شغل كبير وراح يكسر كل الصفحات مؤقتاً لحد ما نخلص ربط كل endpoint. **بدك:**

- **(أ)** ننفذ الخطة كاملة بالترتيب أعلاه (التطبيق راح يكون معطّل جزئياً أثناء العمل، لكن ضامن إطلاق نظيف)، أم
- **(ب)** نخلص المراحل 1+2+7+8 الآن (تنظيف + Node build + checklist) ونبقي الـ demo store كـ data layer مؤقت لحد ما تكون مستعد للمرحلة 3 المنفصلة؟

أرجو تختار قبل ما ننتقل لـ build mode.
