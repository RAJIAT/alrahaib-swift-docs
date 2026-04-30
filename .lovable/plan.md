# لايف شات بين الايجنت والسوبرفايزر

شات مباشر (1-on-1) بين كل **ايجنت** والسوبرفايزر المسؤول عنه، مدعوم بقاعدة البيانات + Realtime، مع إشعارات، إرفاق ملفات، ومؤشرات typing/read.

## نموذج العلاقة

كل ايجنت = محادثة واحدة مع السوبرفايزر تبعه. السوبرفايزر يشوف قائمة كل الايجنتس تحته، الايجنت يشوف محادثة واحدة فقط (مع سوبرفايزره). الادمن يقدر يشوف كل المحادثات (للمراقبة).

```text
Agent A ──┐
Agent B ──┼──► Supervisor X
Agent C ──┘
Agent D ─────► Supervisor Y
```

## التغييرات على قاعدة البيانات

### 1. إضافة دور supervisor + ربط الايجنت بسوبرفايزر
- إضافة `'supervisor'` لـ `app_role` enum.
- إضافة عمود `supervisor_user_id uuid` على جدول `agents` (يشير لـ `auth.users.id` للسوبرفايزر).

### 2. جدول `chat_threads`
- `id uuid pk`, `agent_id text` (FK→agents), `supervisor_user_id uuid`, `agent_user_id uuid`, `last_message_at timestamptz`, `created_at`.
- Unique على `agent_id` (محادثة واحدة لكل ايجنت).

### 3. جدول `chat_messages`
- `id uuid pk`, `thread_id uuid`, `sender_user_id uuid`, `sender_role app_role`, `body text`, `attachment_url text`, `attachment_name text`, `attachment_mime text`, `created_at`.

### 4. جدول `chat_reads`
- `thread_id uuid`, `user_id uuid`, `last_read_at timestamptz`, PK مركّب. لحساب عدد الرسائل غير المقروءة.

### 5. جدول `chat_typing` (اختياري خفيف، يكفينا Realtime broadcast بدون جدول)
سنستخدم Supabase **Realtime Presence/Broadcast** لحالة typing بدون تخزين.

### RLS
- `chat_threads`: SELECT للسوبرفايزر/الايجنت المعنيين + admin.
- `chat_messages`: SELECT/INSERT لأطراف الـ thread فقط + admin يقرأ الكل.
- `chat_reads`: كل user يحدّث صفه فقط.
- تفعيل Realtime على `chat_messages` و `chat_threads`.

### Storage
- استخدام bucket `request-docs` نفسه أو إنشاء bucket جديد `chat-attachments` (private) مع policies لأطراف المحادثة.

## التغييرات في الواجهة

### مكوّن `<ChatWidget />` (يظهر بكل صفحات Dashboard)
- زر عائم أسفل يمين فيه badge بعدد الرسائل غير المقروءة (مجموع كل الـ threads).
- بالضغط يفتح Drawer/Sheet:
  - **للسوبرفايزر**: قائمة الايجنتس (مع badge لكل واحد + آخر رسالة + الوقت)، الضغط يفتح المحادثة.
  - **للايجنت**: يفتح مباشرة على المحادثة الوحيدة مع سوبرفايزره.
  - **للادمن**: قائمة كل الـ threads (read-only أو participate).

### مكوّن `<ChatThread />`
- Header: اسم الطرف الآخر + حالة online (presence).
- Body: رسائل بترتيب زمني، فقاعات (مرسل يمين / مستقبِل يسار)، الوقت، اسم المرسل، حالة قراءة (✓ / ✓✓).
- مؤشر "يكتب الآن…" تحت آخر رسالة.
- Input: نص + زر 📎 مرفق + زر إرسال. Enter للإرسال، Shift+Enter سطر جديد.
- المرفقات: صور preview inline، باقي الملفات chip قابل للتحميل.

### إشعارات
- subscribe على `chat_messages` realtime → تحديث badge مباشرة + toast لو الـ widget مغلق.
- favicon/title prefix: `(3) Dashboard…` لما في رسائل غير مقروءة.

### Typing & Read
- **Typing**: Supabase Channel `chat:thread:{id}` + presence/broadcast لحدث `typing` (debounce 1s).
- **Read receipts**: لما الـ thread مفتوح + الرسالة ظاهرة → upsert `chat_reads.last_read_at = now()`. الطرف الآخر يستعلم/يشترك ويعرض ✓✓.

## التغييرات في الادمن

في صفحة `/agents`: عند تحرير ايجنت، إضافة dropdown **"السوبرفايزر المسؤول"** يختار من user_roles=supervisor → يحفظ في `agents.supervisor_user_id`.

في صفحة `/admin`: زر **"المحادثات"** لعرض كل الـ threads (للمراقبة).

## التغييرات على القائمة الموجودة

- إضافة الـ `<ChatWidget />` داخل `DashboardShell.tsx` (يظهر تلقائياً في admin/agent/audit/agents/requests).
- لا يظهر للعميل (صفحة `/` و `/r/$requestId`).
- إضافة ترجمات AR/EN لكل نصوص الشات.

## الملفات الجديدة/المعدّلة

**جديدة:**
- `src/components/ChatWidget.tsx`
- `src/components/ChatThread.tsx`
- `src/components/ChatThreadList.tsx` (للسوبرفايزر/الادمن)
- `src/services/chat.ts` (CRUD + realtime helpers)
- `src/hooks/useUnreadChatCount.ts`

**معدّلة:**
- `src/components/DashboardShell.tsx` — حقن ChatWidget
- `src/components/AgentFormDialog.tsx` — حقل اختيار السوبرفايزر
- `src/i18n/translations.ts` — نصوص الشات
- migration واحدة لكل التغييرات أعلاه

## ملاحظات وقرارات

1. **هل نحتاج إنشاء أدوار supervisor الآن؟** نعم، لازم يكون عندك على الأقل user واحد بدور `supervisor` ثم تربط الايجنتس فيه من شاشة Agents. تحب أضيف صفحة لإدارة السوبرفايزرز أو يكفي ترقية user يدوياً من الادمن؟
2. **حد حجم المرفق**: نفس حد الرفع الحالي (5MB) — موافق؟
3. **سجل/أرشفة**: الرسائل تبقى محفوظة بدون حذف تلقائي.

بعد موافقتك، أنفّذ كل الخطوات بمرّة واحدة (migration + realtime + UI + إشعارات).