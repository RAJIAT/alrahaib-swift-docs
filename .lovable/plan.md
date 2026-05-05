## Goal

تطبيق هرمية الصلاحيات الجديدة الي طلبها العميل: Admin (عام) → Branches → Supervisor → Underwriters + Sales Staff، مع تقييد صلاحيات السوبرفايزر، ولوج تدقيق غني، وموافقة اختيارية من الأدمن.

## التغييرات الرئيسية

### 1. أدوار جديدة (Underwriter + Sales)

حالياً عندنا فقط: `admin` / `supervisor` / `agent`. بنوسعها:

- `AgentRole` يصير: `"supervisor" | "underwriter" | "sales"` (نلغي مفهوم "agent" الموحّد ونعتبر underwriter+sales يشكّلون الستاف داخل الفرع).
- `Role` (نوع المستخدم المسجّل) يصير: `"admin" | "supervisor" | "underwriter" | "sales"`.
- نحافظ على توافق خلفي: أي بيانات قديمة فيها `role: "agent"` نعرضها/نعالجها كـ `underwriter` افتراضياً (migration سهل بالـ seed).

في `demoStore.ts`:
- نضيف `DemoRole = "admin" | "supervisor" | "underwriter" | "sales"`.
- نضيف على `DemoAgent` و `DemoUser` الحقول: `createdByUserId?`, `pendingApproval?: boolean`.
- نوسّع الـ seed: 3 فروع، لكل فرع supervisor + 1-2 underwriter + 1-2 sales، مع IDs بالتنسيق `SUP-001` / `UW-001` / `SLS-001`.
- نضيف toggle عام `demo:settings` فيه `requireAdminApproval: boolean` (افتراضي = false).

### 2. صفحة Agents تتحول لـ Users بـ 3 تابات

`src/routes/agents.tsx` (نسميها داخلياً Users):
- Admin يشوف 3 تابات: **Supervisors / Underwriters / Sales**، مع فلتر فرع.
- Supervisor يشوف تابين فقط: **Underwriters / Sales** ومحصور بفرعه.
- زر "Add" يفتح الفورم بالـ role الحالي مقفول (lockedRole) للسوبرفايزر، والفرع مقفول دائماً على فرع السوبرفايزر.
- Supervisor ما يقدر يحذف يوزر أنشأه Admin (نحقق `createdByUserId`): زر الحذف يصير معطّل بـ tooltip.
- Supervisor يشوف فقط: اليوزرات الي بفرعه أو الي أنشأهم هو.

### 3. Supervisor permissions enforcement

في `services/api.ts` نضيف helpers ونعدل `createAgent` / `updateAgent` / `deleteAgent`:

- `createAgent`: 
  - لو الـ caller سوبرفايزر → نجبر `branch = caller.branch`، ونرفض أي role غير `underwriter`/`sales`، ونسجّل `createdByUserId = caller.id`.
  - لو `requireAdminApproval=true` والـ caller سوبرفايزر → `active=false, pendingApproval=true`.
- `updateAgent`:
  - السوبرفايزر ما يقدر يغيّر `branch` ولا `role` لأي يوزر.
  - السوبرفايزر ما يقدر يعدّل أو يفعّل/يعطّل يوزر أنشأه Admin.
- `deleteAgent`: نفس القاعدة (يمنع لو `createdByUserId !== caller.id` وكان منشأه Admin).
- Admin يبقى فوق كل شيء (يقدر ينقل بين الفروع، يعطّل سوبرفايزر، إلخ).

### 4. Approval workflow (اختياري)

- في صفحة `/admin` نضيف toggle (Switch) "Require Admin approval for new users" (يحفظ بـ `demo:settings`).
- أي يوزر أنشأه سوبرفايزر تحت هذا الوضع: `active=false`, `pendingApproval=true`، يظهر بـ badge "Pending approval" بصفحة Users.
- Admin يشوف زر **Approve** بدل Suspend/Activate لتفعيله، أو **Reject** للحذف.
- `logEvent("agent.pending_created")` و `agent.approved` / `agent.rejected`.

### 5. Audit log enrichment

`logEvent` بصير يخزّن صراحة:
- `createdBy` (actor)، الـ role المنشأ، الفرع، والـ timestamp (موجود أصلاً).
- نضيف actions: `agent.pending_created`, `agent.approved`, `agent.rejected`, `agent.branch_moved` (admin only), `agent.role_changed` (admin only).
- صفحة `/audit` تعرض عمود "Performed by" + "Target role" + "Branch" بشكل واضح (صف من Action).

### 6. Submission flow

الـ submit upload الحالي بستخدم `agentId`. منزبطه يقبل أي يوزر من نوع `underwriter` أو `sales` (الـ underwriter بيرفع الطلبات، الـ sales بيشوفها فقط حسب طلب العميل بعدين — حالياً منخليهم نفس الصلاحية على الطلبات داخل الفرع، ومنوثّق الفرق بتاب). لو حابب تفصيل أدق بصلاحيات الطلبات بين Underwriter و Sales، نوسّعها بمرحلة لاحقة.

### 7. Translations

نضيف للـ AR و EN:
- `tabSupervisors` (موجود)، `tabUnderwriters`, `tabSales`
- `roleSupervisor`, `roleUnderwriter`, `roleSales`
- `addUnderwriter`, `addSales`
- `pendingApproval`, `approve`, `reject`
- `requireApprovalSetting`
- `noEditAdminCreated`, `noDeleteAdminCreated`

### 8. ملفات هتتعدّل/تتنشأ

تعديل:
- `src/services/demoStore.ts` — types + seed + settings helpers
- `src/services/api.ts` — role enforcement, approval, new audit actions
- `src/components/AgentFormDialog.tsx` — role selector جديد (3 خيارات للأدمن، مقفول للسوبرفايزر)
- `src/routes/agents.tsx` — تابات، فلتر فرع (admin)، أزرار Approve/Reject، حظر تعديل/حذف يوزرات الأدمن
- `src/routes/admin.tsx` — toggle الموافقة + counter للـ pending
- `src/routes/audit.tsx` — أعمدة محسّنة
- `src/i18n/translations.ts`
- `src/routes/login.tsx` — quick-login chips للأدوار الجديدة (Supervisor / Underwriter / Sales)

ما بنلمس:
- `client.ts` / `types.ts` (Supabase auto-generated، مش مستخدمين على أي حال بالديمو)

### 9. ملاحظات

- كل شيء لسه local (localStorage) — مفيش تغيير backend.
- ما بنغيّر شكل الـ `agentId` في الـ requests الحالية (نحتفظ بنفس IDs)، بس الـ IDs الجديدة بتتولّد بالـ prefix الصحيح حسب الـ role.
- `resetDemo()` بيعيد كل شي للبذر الجديد — السوبرفايزر يقدر يجرّب فوراً.

### بعد الاعتماد

أنفّذ كل التغييرات دفعة واحدة، أعمل QA سريع للـ login بكل دور، وأرجع بنتيجة جاهزة للعميل.
