/**
 * Phase 3c — Directus-backed requests + notes.
 *
 * - Requests + notes are stored in Directus collections `requests` and
 *   `request_notes` (provisioned by scripts/directus-bootstrap.ts).
 * - Files (images / quotes / attachments) still live in a local per-request
 *   bridge keyed by request id. Phase 3d migrates that to Directus `/files`
 *   and the `request_files` collection. Until then, the bridge keeps the
 *   existing UI working unchanged.
 * - Branch ↔ branch_id and agent_code ↔ user uuid mappings come from the
 *   Phase 3b caches (`directusEntities`).
 */

import { dxRequest } from "./directusClient";
import {
  getAgentsCache,
  getBranchesCache,
  refreshAgents,
  refreshBranches,
} from "./directusEntities";
import type {
  DemoAttachment,
  DemoNote,
  DemoQuote,
  DemoRequest,
  DemoStatus,
} from "./demoStore";

const REQ_EVT = "aib:requests-changed";
const FILES_KEY = "aib:request_files_bridge:v1";

function emit() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(REQ_EVT));
}

// ---------------- local file bridge (Phase 3d will replace) ----------------

export type RequestFilesBlob = {
  images: DemoRequest["images"];
  quotes?: DemoQuote[];
};

function emptyFiles(): RequestFilesBlob {
  return {
    images: { registration: [], license: [], emirates: [], vehicleMedia: [], attachments: [] },
    quotes: [],
  };
}

function readAllFiles(): Record<string, RequestFilesBlob> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(FILES_KEY);
    return raw ? (JSON.parse(raw) as Record<string, RequestFilesBlob>) : {};
  } catch { return {}; }
}
function writeAllFiles(map: Record<string, RequestFilesBlob>) {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(FILES_KEY, JSON.stringify(map)); } catch { /* quota */ }
}

export function getRequestFiles(id: string): RequestFilesBlob {
  return readAllFiles()[id] ?? emptyFiles();
}

export function setRequestFiles(id: string, blob: RequestFilesBlob) {
  const all = readAllFiles();
  all[id] = blob;
  writeAllFiles(all);
}

export function patchRequestFiles(
  id: string,
  patch: (prev: RequestFilesBlob) => RequestFilesBlob,
) {
  const cur = getRequestFiles(id);
  setRequestFiles(id, patch(cur));
}

export function deleteRequestFiles(id: string) {
  const all = readAllFiles();
  delete all[id];
  writeAllFiles(all);
}

// ---------------- mappers ----------------

type DxRequestRow = {
  id: string;
  uuid?: string | null;
  agent?: string | null;          // user uuid
  origin_agent?: string | null;   // user uuid
  branch?: number | null;
  status: DemoStatus;
  customer_name?: string | null;
  customer_email?: string | null;
  customer_phone?: string | null;
  assigned_at?: string | null;
  date_created?: string | null;
};

type DxNoteRow = {
  id: string;
  request: string;
  author?: string | null;
  author_role?: "admin" | "supervisor" | "agent" | null;
  text: string;
  kind: "comment" | "missing";
  resolved_at?: string | null;
  date_created?: string | null;
};

function agentCodeFromUuid(uuid: string | null | undefined): { code: string; name: string } {
  if (!uuid) return { code: "", name: "" };
  const a = getAgentsCache().find((x) => x.userId === uuid);
  return { code: a?.id ?? uuid, name: a?.name ?? uuid };
}
function uuidFromAgentCode(code: string | undefined): string | null {
  if (!code) return null;
  const a = getAgentsCache().find((x) => x.id === code);
  return a?.userId ?? null;
}
function branchCodeFromId(id: number | null | undefined): string {
  if (id == null) return "";
  return getBranchesCache().find((b) => b.id === id)?.code ?? "";
}
function branchIdFromCode(code: string | undefined | null): number | null {
  if (!code) return null;
  return getBranchesCache().find((b) => b.code === code)?.id ?? null;
}

function noteFromRow(n: DxNoteRow): DemoNote {
  const author = agentCodeFromUuid(n.author);
  return {
    id: n.id,
    authorId: n.author ?? "",
    authorName: author.name,
    authorRole: (n.author_role ?? "agent"),
    text: n.text,
    kind: n.kind,
    createdAt: n.date_created ?? new Date().toISOString(),
    resolvedAt: n.resolved_at ?? undefined,
  };
}

function requestFromRow(r: DxRequestRow, notes: DxNoteRow[]): DemoRequest {
  const agent = agentCodeFromUuid(r.agent);
  const origin = r.origin_agent ? agentCodeFromUuid(r.origin_agent) : null;
  const files = getRequestFiles(r.id);
  return {
    id: r.id,
    uuid: r.uuid ?? r.id.toLowerCase(),
    agentId: agent.code,
    agentName: agent.name,
    originAgentId: origin?.code,
    originAgentName: origin?.name,
    assignedAt: r.assigned_at ?? undefined,
    branch: branchCodeFromId(r.branch),
    status: r.status,
    createdAt: r.date_created ?? new Date().toISOString(),
    customerName: r.customer_name ?? undefined,
    customerEmail: r.customer_email ?? undefined,
    customerPhone: r.customer_phone ?? undefined,
    notes: notes.filter((n) => n.request === r.id).map(noteFromRow),
    images: files.images,
    quotes: files.quotes ?? [],
  };
}

// ---------------- entity cache warmup ----------------

async function ensureEntitiesCached(): Promise<void> {
  if (!getBranchesCache().length) { try { await refreshBranches(); } catch {} }
  if (!getAgentsCache().length)    { try { await refreshAgents();   } catch {} }
}

// ---------------- queries ----------------

const REQ_FIELDS =
  "id,uuid,agent,origin_agent,branch,status,customer_name,customer_email,customer_phone,assigned_at,date_created";
const NOTE_FIELDS =
  "id,request,author,author_role,text,kind,resolved_at,date_created";

export async function dxListRequests(opts?: { agentUuid?: string; branchId?: number }): Promise<DemoRequest[]> {
  await ensureEntitiesCached();
  const filters: string[] = [];
  if (opts?.agentUuid) {
    // Either currently assigned OR originally created by the agent.
    filters.push(
      `filter[_or][0][agent][_eq]=${encodeURIComponent(opts.agentUuid)}`,
      `filter[_or][1][origin_agent][_eq]=${encodeURIComponent(opts.agentUuid)}`,
    );
  }
  if (opts?.branchId != null) {
    filters.push(`filter[branch][_eq]=${opts.branchId}`);
  }
  const qs = `?fields=${REQ_FIELDS}&limit=-1&sort=-date_created${filters.length ? "&" + filters.join("&") : ""}`;
  const r = await dxRequest<{ data: DxRequestRow[] }>(`/items/requests${qs}`);
  const ids = r.data.map((x) => x.id);
  let notes: DxNoteRow[] = [];
  if (ids.length) {
    const nq = `?fields=${NOTE_FIELDS}&limit=-1&filter[request][_in]=${ids.map(encodeURIComponent).join(",")}`;
    const nr = await dxRequest<{ data: DxNoteRow[] }>(`/items/request_notes${nq}`);
    notes = nr.data;
  }
  const list = r.data.map((row) => requestFromRow(row, notes));
  // Newest-first using max(createdAt, assignedAt) for reassignments
  const ts = (x: DemoRequest) => (x.assignedAt && x.assignedAt > x.createdAt ? x.assignedAt : x.createdAt);
  list.sort((a, b) => (ts(a) < ts(b) ? 1 : -1));
  return list;
}

export async function dxGetRequest(id: string): Promise<DemoRequest | null> {
  await ensureEntitiesCached();
  // Accept either canonical id or uuid lookup.
  const filter = `filter[_or][0][id][_eq]=${encodeURIComponent(id)}&filter[_or][1][uuid][_eq]=${encodeURIComponent(id.toLowerCase())}`;
  const r = await dxRequest<{ data: DxRequestRow[] }>(`/items/requests?fields=${REQ_FIELDS}&limit=1&${filter}`);
  const row = r.data[0];
  if (!row) return null;
  const nr = await dxRequest<{ data: DxNoteRow[] }>(
    `/items/request_notes?fields=${NOTE_FIELDS}&limit=-1&sort=date_created&filter[request][_eq]=${encodeURIComponent(row.id)}`,
  );
  return requestFromRow(row, nr.data);
}

// ---------------- mutations ----------------

export type DxCreateRequestInput = {
  id: string;
  uuid: string;
  agentCode: string;
  branchCode: string;
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
};

export async function dxCreateRequest(input: DxCreateRequestInput): Promise<DemoRequest> {
  await ensureEntitiesCached();
  const agentUuid = uuidFromAgentCode(input.agentCode);
  const branchId = branchIdFromCode(input.branchCode);
  const body: Record<string, unknown> = {
    id: input.id,
    status: "new",
    customer_name: input.customerName ?? null,
    customer_email: input.customerEmail ?? null,
    customer_phone: input.customerPhone ?? null,
  };
  if (agentUuid) { body.agent = agentUuid; body.origin_agent = agentUuid; }
  if (branchId != null) body.branch = branchId;
  const r = await dxRequest<{ data: DxRequestRow }>(
    `/items/requests?fields=${REQ_FIELDS}`,
    { method: "POST", body: JSON.stringify(body) },
  );
  emit();
  return requestFromRow(r.data, []);
}

export async function dxPatchRequest(id: string, patch: Record<string, unknown>): Promise<DemoRequest> {
  const r = await dxRequest<{ data: DxRequestRow }>(
    `/items/requests/${encodeURIComponent(id)}?fields=${REQ_FIELDS}`,
    { method: "PATCH", body: JSON.stringify(patch) },
  );
  const nr = await dxRequest<{ data: DxNoteRow[] }>(
    `/items/request_notes?fields=${NOTE_FIELDS}&limit=-1&sort=date_created&filter[request][_eq]=${encodeURIComponent(id)}`,
  );
  emit();
  return requestFromRow(r.data, nr.data);
}

export async function dxSetRequestStatus(id: string, status: DemoStatus): Promise<DemoRequest> {
  return dxPatchRequest(id, { status });
}

export async function dxReassignRequest(id: string, opts: {
  newAgentCode: string;
  captureOriginAgentCode?: string;
}): Promise<DemoRequest> {
  const agentUuid = uuidFromAgentCode(opts.newAgentCode);
  if (!agentUuid) throw new Error("Target agent not found in Directus");
  const body: Record<string, unknown> = {
    agent: agentUuid,
    assigned_at: new Date().toISOString(),
  };
  if (opts.captureOriginAgentCode) {
    const originUuid = uuidFromAgentCode(opts.captureOriginAgentCode);
    if (originUuid) body.origin_agent = originUuid;
  }
  return dxPatchRequest(id, body);
}

export async function dxAddNote(
  requestId: string,
  input: { text: string; kind: "comment" | "missing"; authorId: string; authorRole: "admin" | "supervisor" | "agent" },
): Promise<DemoRequest> {
  await dxRequest(`/items/request_notes`, {
    method: "POST",
    body: JSON.stringify({
      request: requestId,
      author: input.authorId || null,
      author_role: input.authorRole,
      text: input.text.trim(),
      kind: input.kind,
    }),
  });
  // If "missing", flip status to reupload in the same logical operation.
  if (input.kind === "missing") {
    try { await dxSetRequestStatus(requestId, "reupload"); } catch { /* tolerated */ }
  }
  const req = await dxGetRequest(requestId);
  if (!req) throw new Error("Request not found after note add");
  emit();
  return req;
}

export async function dxResolveNote(requestId: string, noteId: string): Promise<DemoRequest> {
  await dxRequest(`/items/request_notes/${encodeURIComponent(noteId)}`, {
    method: "PATCH",
    body: JSON.stringify({ resolved_at: new Date().toISOString() }),
  });
  const req = await dxGetRequest(requestId);
  if (!req) throw new Error("Request not found after note resolve");
  emit();
  return req;
}

// ---------------- attachment / quote file bridge mutators ----------------

export function appendMissingAttachmentsLocal(id: string, atts: DemoAttachment[]) {
  patchRequestFiles(id, (prev) => ({
    ...prev,
    images: {
      ...prev.images,
      missingAttachments: [...(prev.images.missingAttachments ?? []), ...atts],
    },
  }));
}

export function appendQuotesLocal(id: string, quotes: DemoQuote[]) {
  patchRequestFiles(id, (prev) => ({
    ...prev,
    quotes: [...(prev.quotes ?? []), ...quotes],
  }));
}

export function removeQuoteLocal(id: string, quoteId: string) {
  patchRequestFiles(id, (prev) => ({
    ...prev,
    quotes: (prev.quotes ?? []).filter((q) => q.id !== quoteId),
  }));
}