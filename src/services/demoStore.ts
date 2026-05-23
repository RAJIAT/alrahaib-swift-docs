/**
 * Demo Store — fully local, no backend.
 *
 * All app data lives in localStorage. Files are converted to data URLs.
 * The store seeds itself on first access with a small set of users,
 * branches, agents and sample requests so a visitor can immediately try
 * every dashboard.
 */

export type DemoRole = "admin" | "supervisor" | "agent";
/** Sub-type for staff users (role="agent"). */
export type DemoStaffType = "underwriter" | "sales";
export type DemoStatus = "new" | "linkSent" | "processing" | "sold" | "rejected" | "reupload";

export type DemoUser = {
  id: string;
  email: string;
  password: string;
  name: string;
  role: DemoRole;
  agentId?: string;
  branch?: string;
};

export type DemoBranch = {
  id: number;
  name: string;
  code: string;
  address?: string;
  phone?: string;
  is_active: boolean;
};

export type DemoAgent = {
  userId: string;
  id: string;
  name: string;
  email?: string;
  branch?: string;
  active: boolean;
  role: "agent" | "supervisor";
  staffType?: DemoStaffType;
  supervisorId?: string;
  /** For sales agents only — id of the underwriter their requests are routed to. */
  assignedUnderwriterId?: string;
  createdByUserId?: string;
  createdByRole?: DemoRole;
  pendingApproval?: boolean;
  removalRequest?: {
    requestedByUserId: string;
    requestedByName: string;
    reason: string;
    requestedAt: string;
  };
};

export type DemoNotification = {
  id: string;
  recipientUserId: string;
  title: string;
  body?: string;
  kind: "removal_requested" | "removal_approved" | "removal_dismissed" | "user_pending" | "user_approved" | "request_new" | "request_status" | "info";
  link?: string;
  read: boolean;
  createdAt: string;
};

export type DemoNote = {
  id: string;
  authorId: string;
  authorName: string;
  authorRole: DemoRole;
  text: string;
  kind: "comment" | "missing";
  createdAt: string;
  resolvedAt?: string;
};

export type DemoAttachment = { name: string; type: string; size: number; url: string };

export type DemoRequest = {
  id: string;
  uuid: string;
  agentId: string;
  agentName: string;
  /** The original agent (sales) who first received the request — used to return after underwriter review. */
  originAgentId?: string;
  originAgentName?: string;
  /** Timestamp of the most recent assignment/reassignment — used to sort newest at top. */
  assignedAt?: string;
  branch: string;
  status: DemoStatus;
  createdAt: string;
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
  notes: DemoNote[];
  images: {
    registration: string[];
    license: string[];
    emirates: string[];
    vehicleMedia: Array<
      | { kind: "image"; url: string }
      | { kind: "video"; name: string; size: number; type: string }
    >;
    inspection?: string;
    attachments: DemoAttachment[];
    missingAttachments?: DemoAttachment[];
  };
  quotes?: DemoQuote[];
};

export type DemoQuote = {
  id: string;
  name: string;
  type: string;
  size: number;
  url: string;
  uploadedByUserId: string;
  uploadedByName: string;
  uploadedAt: string;
};

export type DemoAuditEntry = {
  id: string;
  ts: string;
  actorId: string | null;
  actorName: string | null;
  actorRole: DemoRole | "anonymous";
  actorBranch?: string | null;
  action: string;
  entityType: "request" | "agent" | "auth";
  entityId: string | null;
  entityLabel?: string | null;
  branch?: string | null;
  before?: unknown;
  after?: unknown;
  meta?: Record<string, unknown>;
};

export type DemoSettings = {
  requireAdminApproval: boolean;
};

const KEY = {
  users: "demo:users",
  branches: "demo:branches",
  agents: "demo:agents",
  requests: "demo:requests",
  audit: "demo:audit",
  seq: "demo:seq",
  settings: "demo:settings",
  notifications: "demo:notifications",
  seeded: "demo:seeded:v4",
};

// ---------- Seed data ----------

const PLACEHOLDER_DOC =
  "data:image/svg+xml;base64," +
  btoa(
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 600 380'><rect width='600' height='380' fill='#e0e7ff'/><rect x='30' y='30' width='540' height='320' rx='12' fill='#fff' stroke='#6366f1' stroke-width='2'/><text x='300' y='200' font-family='sans-serif' font-size='32' font-weight='bold' text-anchor='middle' fill='#4338ca'>SAMPLE DOCUMENT</text><text x='300' y='240' font-family='sans-serif' font-size='16' text-anchor='middle' fill='#6366f1'>Demo placeholder</text></svg>`,
  );

const PLACEHOLDER_CAR =
  "data:image/svg+xml;base64," +
  btoa(
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 600 380'><rect width='600' height='380' fill='#fef3c7'/><rect x='100' y='180' width='400' height='100' rx='30' fill='#f59e0b'/><circle cx='180' cy='290' r='35' fill='#1f2937'/><circle cx='420' cy='290' r='35' fill='#1f2937'/><text x='300' y='340' font-family='sans-serif' font-size='14' text-anchor='middle' fill='#92400e'>Vehicle photo (demo)</text></svg>`,
  );

function seedUsers(): DemoUser[] {
  return [
    { id: "u-admin", email: "admin@demo.com", password: "demo123", name: "Demo Admin", role: "admin" },
    // Branch 1: Dubai
    { id: "u-sup-1", email: "supervisor@demo.com", password: "demo123", name: "Demo Supervisor (Dubai)", role: "supervisor", branch: "Dubai" },
    { id: "u-uw-1", email: "underwriter@demo.com", password: "demo123", name: "Omar Underwriter", role: "agent", agentId: "UW-001", branch: "Dubai" },
    { id: "u-uw-2", email: "uw2@demo.com", password: "demo123", name: "Hala Underwriter", role: "agent", agentId: "UW-002", branch: "Dubai" },
    { id: "u-sls-1", email: "sales@demo.com", password: "demo123", name: "Ali Sales", role: "agent", agentId: "SLS-001", branch: "Dubai" },
    { id: "u-sls-2", email: "sls2@demo.com", password: "demo123", name: "Noor Sales", role: "agent", agentId: "SLS-002", branch: "Dubai" },
    // Branch 2: Abu Dhabi
    { id: "u-sup-2", email: "sup2@demo.com", password: "demo123", name: "Khalid Supervisor (Abu Dhabi)", role: "supervisor", branch: "Abu Dhabi" },
    { id: "u-uw-3", email: "uw3@demo.com", password: "demo123", name: "Sara Underwriter", role: "agent", agentId: "UW-003", branch: "Abu Dhabi" },
    { id: "u-sls-3", email: "sls3@demo.com", password: "demo123", name: "Yara Sales", role: "agent", agentId: "SLS-003", branch: "Abu Dhabi" },
    // Branch 3: Sharjah
    { id: "u-sup-3", email: "sup3@demo.com", password: "demo123", name: "Faisal Supervisor (Sharjah)", role: "supervisor", branch: "Sharjah" },
    { id: "u-uw-4", email: "uw4@demo.com", password: "demo123", name: "Lina Underwriter", role: "agent", agentId: "UW-004", branch: "Sharjah" },
  ];
}

function seedBranches(): DemoBranch[] {
  return [
    { id: 1, name: "Dubai", code: "Dubai", is_active: true },
    { id: 2, name: "Abu Dhabi", code: "Abu Dhabi", is_active: true },
    { id: 3, name: "Sharjah", code: "Sharjah", is_active: true },
  ];
}

function seedAgents(): DemoAgent[] {
  return [
    // Dubai
    { userId: "u-sup-1", id: "SUP-001", name: "Demo Supervisor (Dubai)", email: "supervisor@demo.com", branch: "Dubai", active: true, role: "supervisor", createdByUserId: "u-admin", createdByRole: "admin" },
    { userId: "u-uw-1", id: "UW-001", name: "Omar Underwriter", email: "underwriter@demo.com", branch: "Dubai", active: true, role: "agent", staffType: "underwriter", supervisorId: "u-sup-1", createdByUserId: "u-admin", createdByRole: "admin" },
    { userId: "u-uw-2", id: "UW-002", name: "Hala Underwriter", email: "uw2@demo.com", branch: "Dubai", active: true, role: "agent", staffType: "underwriter", supervisorId: "u-sup-1", createdByUserId: "u-sup-1", createdByRole: "supervisor" },
    { userId: "u-sls-1", id: "SLS-001", name: "Ali Sales", email: "sales@demo.com", branch: "Dubai", active: true, role: "agent", staffType: "sales", supervisorId: "u-sup-1", createdByUserId: "u-admin", createdByRole: "admin" },
    { userId: "u-sls-2", id: "SLS-002", name: "Noor Sales", email: "sls2@demo.com", branch: "Dubai", active: true, role: "agent", staffType: "sales", supervisorId: "u-sup-1", createdByUserId: "u-sup-1", createdByRole: "supervisor" },
    // Abu Dhabi
    { userId: "u-sup-2", id: "SUP-002", name: "Khalid Supervisor (Abu Dhabi)", email: "sup2@demo.com", branch: "Abu Dhabi", active: true, role: "supervisor", createdByUserId: "u-admin", createdByRole: "admin" },
    { userId: "u-uw-3", id: "UW-003", name: "Sara Underwriter", email: "uw3@demo.com", branch: "Abu Dhabi", active: true, role: "agent", staffType: "underwriter", supervisorId: "u-sup-2", createdByUserId: "u-sup-2", createdByRole: "supervisor" },
    { userId: "u-sls-3", id: "SLS-003", name: "Yara Sales", email: "sls3@demo.com", branch: "Abu Dhabi", active: true, role: "agent", staffType: "sales", supervisorId: "u-sup-2", createdByUserId: "u-sup-2", createdByRole: "supervisor" },
    // Sharjah
    { userId: "u-sup-3", id: "SUP-003", name: "Faisal Supervisor (Sharjah)", email: "sup3@demo.com", branch: "Sharjah", active: true, role: "supervisor", createdByUserId: "u-admin", createdByRole: "admin" },
    { userId: "u-uw-4", id: "UW-004", name: "Lina Underwriter", email: "uw4@demo.com", branch: "Sharjah", active: true, role: "agent", staffType: "underwriter", supervisorId: "u-sup-3", createdByUserId: "u-sup-3", createdByRole: "supervisor" },
  ];
}

function seedRequests(): DemoRequest[] {
  const now = Date.now();
  const iso = (offsetMin: number) => new Date(now - offsetMin * 60_000).toISOString();
  return [
    {
      id: "REQ-1001", uuid: "req-1001",
      agentId: "UW-001", agentName: "Omar Underwriter", branch: "Dubai",
      status: "new", createdAt: iso(15),
      customerName: "Mohammad Ali", customerEmail: "mohammad@example.com", customerPhone: "+971501234567",
      notes: [],
      images: {
        registration: [PLACEHOLDER_DOC], license: [PLACEHOLDER_DOC], emirates: [PLACEHOLDER_DOC],
        vehicleMedia: [{ kind: "image", url: PLACEHOLDER_CAR }],
        attachments: [],
      },
    },
    {
      id: "REQ-1002", uuid: "req-1002",
      agentId: "UW-001", agentName: "Omar Underwriter", branch: "Dubai",
      status: "processing", createdAt: iso(180),
      customerName: "Fatima Al Hassan", customerEmail: "fatima@example.com", customerPhone: "+971502345678",
      notes: [
        { id: "n1", authorId: "u-uw-1", authorName: "Omar Underwriter", authorRole: "agent", text: "Quote requested from insurer.", kind: "comment", createdAt: iso(120) },
      ],
      images: {
        registration: [PLACEHOLDER_DOC], license: [PLACEHOLDER_DOC], emirates: [PLACEHOLDER_DOC],
        vehicleMedia: [{ kind: "image", url: PLACEHOLDER_CAR }, { kind: "image", url: PLACEHOLDER_CAR }],
        attachments: [],
      },
    },
    {
      id: "REQ-1003", uuid: "req-1003",
      agentId: "UW-003", agentName: "Sara Underwriter", branch: "Abu Dhabi",
      status: "sold", createdAt: iso(60 * 24),
      customerName: "Khalid Saeed", customerEmail: "khalid@example.com",
      notes: [],
      images: {
        registration: [PLACEHOLDER_DOC], license: [PLACEHOLDER_DOC], emirates: [PLACEHOLDER_DOC],
        vehicleMedia: [], attachments: [],
      },
    },
    {
      id: "REQ-1004", uuid: "req-1004",
      agentId: "SLS-001", agentName: "Ali Sales", branch: "Dubai",
      status: "reupload", createdAt: iso(60 * 6),
      customerName: "Layla Ibrahim", customerEmail: "layla@example.com", customerPhone: "+971503456789",
      notes: [
        { id: "n2", authorId: "u-sls-1", authorName: "Ali Sales", authorRole: "agent", text: "Please send a clearer photo of the registration back.", kind: "missing", createdAt: iso(300) },
      ],
      images: {
        registration: [PLACEHOLDER_DOC], license: [PLACEHOLDER_DOC], emirates: [PLACEHOLDER_DOC],
        vehicleMedia: [], attachments: [],
      },
    },
    {
      id: "REQ-1005", uuid: "req-1005",
      agentId: "SLS-001", agentName: "Ali Sales", branch: "Dubai",
      status: "new", createdAt: iso(25),
      customerName: "Hassan Al Marri", customerEmail: "hassan@example.com", customerPhone: "+971504567890",
      notes: [],
      images: {
        registration: [PLACEHOLDER_DOC], license: [PLACEHOLDER_DOC], emirates: [PLACEHOLDER_DOC],
        vehicleMedia: [{ kind: "image", url: PLACEHOLDER_CAR }], attachments: [],
      },
    },
    {
      id: "REQ-1006", uuid: "req-1006",
      agentId: "SLS-001", agentName: "Ali Sales", branch: "Dubai",
      status: "processing", createdAt: iso(60 * 3),
      customerName: "Mariam Saleh", customerEmail: "mariam@example.com", customerPhone: "+971505678901",
      notes: [
        { id: "n3", authorId: "u-uw-1", authorName: "Omar Underwriter", authorRole: "agent", text: "Working on the quote.", kind: "comment", createdAt: iso(60) },
      ],
      images: {
        registration: [PLACEHOLDER_DOC], license: [PLACEHOLDER_DOC], emirates: [PLACEHOLDER_DOC],
        vehicleMedia: [{ kind: "image", url: PLACEHOLDER_CAR }], attachments: [],
      },
    },
    {
      id: "REQ-1007", uuid: "req-1007",
      agentId: "SLS-001", agentName: "Ali Sales", branch: "Dubai",
      status: "sold", createdAt: iso(60 * 48),
      customerName: "Yousef Karim", customerEmail: "yousef@example.com", customerPhone: "+971506789012",
      notes: [],
      images: {
        registration: [PLACEHOLDER_DOC], license: [PLACEHOLDER_DOC], emirates: [PLACEHOLDER_DOC],
        vehicleMedia: [], attachments: [],
      },
    },
    {
      id: "REQ-1008", uuid: "req-1008",
      agentId: "SLS-001", agentName: "Ali Sales", branch: "Dubai",
      status: "linkSent", createdAt: iso(60 * 2),
      customerName: "Aisha Khalifa", customerEmail: "aisha@example.com", customerPhone: "+971507890123",
      notes: [],
      images: {
        registration: [PLACEHOLDER_DOC], license: [PLACEHOLDER_DOC], emirates: [PLACEHOLDER_DOC],
        vehicleMedia: [], attachments: [],
      },
    },
    {
      id: "REQ-1009", uuid: "req-1009",
      agentId: "SLS-002", agentName: "Noor Sales", branch: "Dubai",
      status: "new", createdAt: iso(45),
      customerName: "Tariq Hamdan", customerEmail: "tariq@example.com", customerPhone: "+971508901234",
      notes: [],
      images: {
        registration: [PLACEHOLDER_DOC], license: [PLACEHOLDER_DOC], emirates: [PLACEHOLDER_DOC],
        vehicleMedia: [], attachments: [],
      },
    },
  ];
}

// ---------- Storage helpers ----------

function read<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function write<T>(key: string, value: T) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.warn("[demo] write failed", key, e);
  }
}

let _seeded = false;
function ensureSeeded() {
  if (_seeded) return;
  if (typeof window === "undefined") return;
  if (localStorage.getItem(KEY.seeded)) { _seeded = true; return; }
  // Clear older seeds
  ["demo:seeded:v1", "demo:seeded:v2", "demo:seeded:v3"].forEach((k) => localStorage.removeItem(k));
  write(KEY.users, seedUsers());
  write(KEY.branches, seedBranches());
  write(KEY.agents, seedAgents());
  write(KEY.requests, seedRequests());
  write(KEY.audit, [] as DemoAuditEntry[]);
  write(KEY.seq, 1010);
  write(KEY.settings, { requireAdminApproval: false } as DemoSettings);
  write(KEY.notifications, [] as DemoNotification[]);
  localStorage.setItem(KEY.seeded, "1");
  _seeded = true;
}

export function resetDemo() {
  if (typeof window === "undefined") return;
  [KEY.users, KEY.branches, KEY.agents, KEY.requests, KEY.audit, KEY.seq, KEY.settings, KEY.notifications, KEY.seeded].forEach((k) =>
    localStorage.removeItem(k),
  );
  _seeded = false;
  ensureSeeded();
  notify("requests");
  notify("agents");
  notify("branches");
  notify("audit");
  notify("notifications");
}

const EVT: Record<string, string> = {
  requests: "aib:requests-changed",
  agents: "aib:agents-changed",
  branches: "aib:branches-changed",
  audit: "aib:audit-changed",
  settings: "aib:settings-changed",
  notifications: "aib:notifications-changed",
};

export function notify(kind: keyof typeof EVT) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(EVT[kind]));
}

function nextSeq(): number {
  ensureSeeded();
  const cur = read<number>(KEY.seq, 1005);
  write(KEY.seq, cur + 1);
  return cur;
}

// ---------- Public API ----------

export function getUsers(): DemoUser[] { ensureSeeded(); return read(KEY.users, [] as DemoUser[]); }
export function setUsers(list: DemoUser[]) { write(KEY.users, list); }
export function getBranches(): DemoBranch[] { ensureSeeded(); return read(KEY.branches, [] as DemoBranch[]); }
export function setBranches(list: DemoBranch[]) { write(KEY.branches, list); notify("branches"); }
export function getAgents(): DemoAgent[] { ensureSeeded(); return read(KEY.agents, [] as DemoAgent[]); }
export function setAgents(list: DemoAgent[]) { write(KEY.agents, list); notify("agents"); }
export function getRequests(): DemoRequest[] { ensureSeeded(); return read(KEY.requests, [] as DemoRequest[]); }
export function setRequests(list: DemoRequest[]) { write(KEY.requests, list); notify("requests"); }
export function getAudit(): DemoAuditEntry[] { ensureSeeded(); return read(KEY.audit, [] as DemoAuditEntry[]); }
export function setAudit(list: DemoAuditEntry[]) { write(KEY.audit, list); notify("audit"); }

export function getSettings(): DemoSettings {
  ensureSeeded();
  return read(KEY.settings, { requireAdminApproval: false } as DemoSettings);
}
export function setSettings(s: DemoSettings) { write(KEY.settings, s); notify("settings"); }
export function subscribeSettings(cb: () => void) {
  if (typeof window === "undefined") return () => {};
  const fn = () => cb();
  window.addEventListener("aib:settings-changed", fn);
  return () => window.removeEventListener("aib:settings-changed", fn);
}

// ---------- Notifications ----------

export function getNotifications(): DemoNotification[] {
  ensureSeeded();
  return read(KEY.notifications, [] as DemoNotification[]);
}
export function setNotifications(list: DemoNotification[]) {
  write(KEY.notifications, list); notify("notifications");
}
export function subscribeNotifications(cb: () => void) {
  if (typeof window === "undefined") return () => {};
  const fn = () => cb();
  window.addEventListener("aib:notifications-changed", fn);
  return () => window.removeEventListener("aib:notifications-changed", fn);
}
export function pushNotifications(items: Omit<DemoNotification, "id" | "read" | "createdAt">[]) {
  if (items.length === 0) return;
  const now = new Date().toISOString();
  const next: DemoNotification[] = items.map((n) => ({
    ...n,
    id: crypto.randomUUID(),
    read: false,
    createdAt: now,
  }));
  setNotifications([...next, ...getNotifications()].slice(0, 200));
}

export function newRequestId(): string { return `REQ-${nextSeq()}`; }

// ---------- File → data URL ----------

const MAX_EDGE = 1400;
const JPEG_QUALITY = 0.8;

export async function fileToDataUrl(file: File): Promise<string> {
  if (file.type.startsWith("image/")) {
    try { return await downscale(file); } catch { /* fall through */ }
  }
  return await readAsDataUrl(file);
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result ?? ""));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

async function downscale(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url;
    });
    let w = img.naturalWidth, h = img.naturalHeight;
    if (w > MAX_EDGE || h > MAX_EDGE) {
      const r = w > h ? MAX_EDGE / w : MAX_EDGE / h;
      w = Math.round(w * r); h = Math.round(h * r);
    }
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const ctx = c.getContext("2d");
    if (!ctx) throw new Error("no ctx");
    ctx.drawImage(img, 0, 0, w, h);
    return c.toDataURL("image/jpeg", JPEG_QUALITY);
  } finally {
    URL.revokeObjectURL(url);
  }
}
