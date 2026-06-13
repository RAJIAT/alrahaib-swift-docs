/**
 * Directus Seed — يضيف بيانات تجريبية مطابقة لـ src/services/demoStore.ts.
 *
 * تشغيل بعد bootstrap:
 *   DIRECTUS_URL=http://127.0.0.1:8055 DIRECTUS_ADMIN_TOKEN= npx tsx scripts/directus-seed.ts
 *
 * Idempotent: يفحص بالـ email/code قبل الإنشاء.
 */

const URL_BASE = process.env.DIRECTUS_URL?.replace(/\/$/, "");
const TOKEN = process.env.DIRECTUS_ADMIN_TOKEN;
if (!URL_BASE || !TOKEN) {
  console.error("❌ Missing DIRECTUS_URL or DIRECTUS_ADMIN_TOKEN.");
  process.exit(1);
}

async function api<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${URL_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`[${res.status}] ${path}: ${await res.text()}`);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

async function findRoleId(name: string): Promise<string> {
  const r = await api<{ data: Array<{ id: string; name: string }> }>(
    `/roles?filter[name][_eq]=${encodeURIComponent(name)}&limit=1`,
  );
  if (!r.data[0]) throw new Error(`Role "${name}" not found — run bootstrap first.`);
  return r.data[0].id;
}

async function upsertBranch(name: string, code: string): Promise<number> {
  const r = await api<{ data: Array<{ id: number }> }>(
    `/items/branches?filter[code][_eq]=${encodeURIComponent(code)}&limit=1`,
  );
  if (r.data[0]) return r.data[0].id;
  const c = await api<{ data: { id: number } }>("/items/branches", {
    method: "POST",
    body: JSON.stringify({ name, code, is_active: true }),
  });
  return c.data.id;
}

type SeedUser = {
  email: string;
  password: string;
  first_name: string;
  last_name: string;
  app_role: "admin" | "supervisor" | "agent";
  staff_type?: "underwriter" | "sales";
  branch?: number;
  agent_code?: string;
  supervisorEmail?: string;
  assignedUnderwriterCode?: string;
  roleName: "Admin" | "Supervisor" | "Agent";
};

async function upsertUser(u: SeedUser, directusRoleId: string): Promise<string> {
  const r = await api<{ data: Array<{ id: string }> }>(
    `/users?filter[email][_eq]=${encodeURIComponent(u.email)}&limit=1`,
  );
  if (r.data[0]) return r.data[0].id;
  const c = await api<{ data: { id: string } }>("/users", {
    method: "POST",
    body: JSON.stringify({
      email: u.email,
      password: u.password,
      first_name: u.first_name,
      last_name: u.last_name,
      role: directusRoleId,
      app_role: u.app_role,
      staff_type: u.staff_type ?? null,
      branch: u.branch ?? null,
      agent_code: u.agent_code ?? null,
      app_active: true,
      pending_approval: false,
      status: "active",
    }),
  });
  return c.data.id;
}

async function setUserRefs(
  userId: string,
  patch: { supervisor?: string; assigned_underwriter?: string },
) {
  if (!patch.supervisor && !patch.assigned_underwriter) return;
  await api(`/users/${userId}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

async function findUserByCode(code: string): Promise<string | null> {
  const r = await api<{ data: Array<{ id: string }> }>(
    `/users?filter[agent_code][_eq]=${encodeURIComponent(code)}&limit=1`,
  );
  return r.data[0]?.id ?? null;
}

async function findUserByEmail(email: string): Promise<string | null> {
  const r = await api<{ data: Array<{ id: string }> }>(
    `/users?filter[email][_eq]=${encodeURIComponent(email)}&limit=1`,
  );
  return r.data[0]?.id ?? null;
}

async function upsertRequest(req: {
  id: string;
  agent_code: string;
  branch_id: number;
  status: string;
  customer_name?: string;
  customer_email?: string;
  customer_phone?: string;
}) {
  const exists = await api<{ data: { id: string } | null }>(`/items/requests/${req.id}`).catch(
    () => null,
  );
  if (exists?.data) return;
  const agentId = await findUserByCode(req.agent_code);
  if (!agentId) throw new Error(`Agent ${req.agent_code} missing`);
  await api("/items/requests", {
    method: "POST",
    body: JSON.stringify({
      id: req.id,
      agent: agentId,
      origin_agent: agentId,
      branch: req.branch_id,
      status: req.status,
      customer_name: req.customer_name,
      customer_email: req.customer_email,
      customer_phone: req.customer_phone,
      assigned_at: new Date().toISOString(),
    }),
  });
}

async function main() {
  console.log("🌱 Seeding…");

  const adminRoleId = await findRoleId("Admin");
  const supRoleId = await findRoleId("Supervisor");
  const agentRoleId = await findRoleId("Agent");

  const dubai = await upsertBranch("Dubai", "Dubai");
  const auh = await upsertBranch("Abu Dhabi", "Abu Dhabi");
  const shj = await upsertBranch("Sharjah", "Sharjah");
  console.log(`   branches: Dubai=${dubai}, AbuDhabi=${auh}, Sharjah=${shj}`);

  const users: SeedUser[] = [
    { email: "admin@demo.com", password: "demo123", first_name: "Demo", last_name: "Admin", app_role: "admin", roleName: "Admin" },
    // Dubai
    { email: "supervisor@demo.com", password: "demo123", first_name: "Demo", last_name: "Supervisor (Dubai)", app_role: "supervisor", branch: dubai, roleName: "Supervisor" },
    { email: "underwriter@demo.com", password: "demo123", first_name: "Omar", last_name: "Underwriter", app_role: "agent", staff_type: "underwriter", branch: dubai, agent_code: "UW-001", supervisorEmail: "supervisor@demo.com", roleName: "Agent" },
    { email: "uw2@demo.com", password: "demo123", first_name: "Hala", last_name: "Underwriter", app_role: "agent", staff_type: "underwriter", branch: dubai, agent_code: "UW-002", supervisorEmail: "supervisor@demo.com", roleName: "Agent" },
    { email: "sales@demo.com", password: "demo123", first_name: "Ali", last_name: "Sales", app_role: "agent", staff_type: "sales", branch: dubai, agent_code: "SLS-001", supervisorEmail: "supervisor@demo.com", assignedUnderwriterCode: "UW-001", roleName: "Agent" },
    { email: "sls2@demo.com", password: "demo123", first_name: "Noor", last_name: "Sales", app_role: "agent", staff_type: "sales", branch: dubai, agent_code: "SLS-002", supervisorEmail: "supervisor@demo.com", assignedUnderwriterCode: "UW-002", roleName: "Agent" },
    // Abu Dhabi
    { email: "sup2@demo.com", password: "demo123", first_name: "Khalid", last_name: "Supervisor (Abu Dhabi)", app_role: "supervisor", branch: auh, roleName: "Supervisor" },
    { email: "uw3@demo.com", password: "demo123", first_name: "Sara", last_name: "Underwriter", app_role: "agent", staff_type: "underwriter", branch: auh, agent_code: "UW-003", supervisorEmail: "sup2@demo.com", roleName: "Agent" },
    { email: "sls3@demo.com", password: "demo123", first_name: "Yara", last_name: "Sales", app_role: "agent", staff_type: "sales", branch: auh, agent_code: "SLS-003", supervisorEmail: "sup2@demo.com", assignedUnderwriterCode: "UW-003", roleName: "Agent" },
    // Sharjah
    { email: "sup3@demo.com", password: "demo123", first_name: "Faisal", last_name: "Supervisor (Sharjah)", app_role: "supervisor", branch: shj, roleName: "Supervisor" },
    { email: "uw4@demo.com", password: "demo123", first_name: "Lina", last_name: "Underwriter", app_role: "agent", staff_type: "underwriter", branch: shj, agent_code: "UW-004", supervisorEmail: "sup3@demo.com", roleName: "Agent" },
  ];

  const roleMap = { Admin: adminRoleId, Supervisor: supRoleId, Agent: agentRoleId };
  console.log("   users…");
  for (const u of users) {
    const id = await upsertUser(u, roleMap[u.roleName]);
    console.log(`     + ${u.email}`);
    // store back the id for cross-refs (fetch again on second pass)
    void id;
  }

  // 2nd pass: wire supervisor + assigned_underwriter relationships
  console.log("   relationships…");
  for (const u of users) {
    if (!u.supervisorEmail && !u.assignedUnderwriterCode) continue;
    const myId = await findUserByEmail(u.email);
    if (!myId) continue;
    const supId = u.supervisorEmail ? await findUserByEmail(u.supervisorEmail) : undefined;
    const uwId = u.assignedUnderwriterCode ? await findUserByCode(u.assignedUnderwriterCode) : undefined;
    await setUserRefs(myId, {
      supervisor: supId ?? undefined,
      assigned_underwriter: uwId ?? undefined,
    });
  }

  // Sample requests
  console.log("   requests…");
  const reqs = [
    { id: "REQ-1001", agent_code: "UW-001", branch_id: dubai, status: "new", customer_name: "Mohammad Ali", customer_email: "mohammad@example.com", customer_phone: "+971501234567" },
    { id: "REQ-1002", agent_code: "UW-001", branch_id: dubai, status: "processing", customer_name: "Fatima Al Hassan", customer_email: "fatima@example.com", customer_phone: "+971502345678" },
    { id: "REQ-1003", agent_code: "UW-003", branch_id: auh, status: "sold", customer_name: "Khalid Saeed", customer_email: "khalid@example.com" },
    { id: "REQ-1004", agent_code: "SLS-001", branch_id: dubai, status: "reupload", customer_name: "Layla Ibrahim", customer_email: "layla@example.com", customer_phone: "+971503456789" },
    { id: "REQ-1005", agent_code: "SLS-001", branch_id: dubai, status: "new", customer_name: "Hassan Al Marri", customer_email: "hassan@example.com", customer_phone: "+971504567890" },
    { id: "REQ-1006", agent_code: "SLS-001", branch_id: dubai, status: "processing", customer_name: "Mariam Saleh", customer_email: "mariam@example.com", customer_phone: "+971505678901" },
    { id: "REQ-1007", agent_code: "SLS-001", branch_id: dubai, status: "sold", customer_name: "Yousef Karim", customer_email: "yousef@example.com", customer_phone: "+971506789012" },
    { id: "REQ-1008", agent_code: "SLS-001", branch_id: dubai, status: "linkSent", customer_name: "Aisha Khalifa", customer_email: "aisha@example.com", customer_phone: "+971507890123" },
    { id: "REQ-1009", agent_code: "SLS-002", branch_id: dubai, status: "new", customer_name: "Tariq Hamdan", customer_email: "tariq@example.com", customer_phone: "+971508901234" },
  ];
  for (const r of reqs) {
    await upsertRequest(r);
    console.log(`     + ${r.id}`);
  }

  console.log("\n✅ Seed complete. Login with admin@demo.com / demo123");
}

main().catch((e) => {
  console.error("💥 Seed failed:", e);
  process.exit(1);
});
