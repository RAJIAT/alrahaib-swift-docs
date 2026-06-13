/**
 * Phase 3c + 3d — Directus-backed requests, notes, and files.
 *
 * - Requests + notes live in Directus (`requests`, `request_notes`).
 * - All uploaded bytes go to Directus `/files`; metadata rows live in
 *   `request_files` with a `kind` tag (registration, license, emirates,
 *   vehicle_image, vehicle_video, inspection, attachment,
 *   missing_attachment, quote).
 * - URLs resolve through `${VITE_DIRECTUS_URL}/assets/{file_id}` via
 *   `dxAssetUrl()`.
 * - The old local file bridge (`aib:request_files_bridge:v1`) is gone; we
 *   wipe it once on first load to clean up any leftover demo state.
 */

import { dxAssetUrl, dxRequest, dxUploadFile } from "./directusClient";
import {
  getAgentsCache,
  getBranchesCache,
  refreshAgents,
  refreshBranches,
} from "./directusEntities";
import type {
  Note as DemoNote,
  Quote as DemoQuote,
  InsuranceRequest as DemoRequest,
  RequestStatus as DemoStatus,
} from "./types";

const REQ_EVT = "aib:requests-changed";
const LEGACY_BRIDGE_KEY = "aib:request_files_bridge:v1";

function emit() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(REQ_EVT));
}

// One-shot cleanup: remove the Phase 3c local file bridge if present.
if (typeof window !== "undefined") {
  try { localStorage.removeItem(LEGACY_BRIDGE_KEY); } catch { /* ignore */ }
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

export type RequestFileKind =
  | "registration"
  | "license"
  | "emirates"
  | "vehicle_image"
  | "vehicle_video"
  | "inspection"
  | "attachment"
  | "missing_attachment"
  | "quote";

type DxFileObj = { id: string; filename_download: string; type: string; filesize: number };

type DxRequestFileRow = {
  id: string;
  request: string;
  kind: RequestFileKind;
  uploaded_by?: string | null;
  uploaded_at?: string | null;
  file?: DxFileObj | string | null;
};

type DxAgentLookupRow = {
  id: string;
  first_name?: string | null;
  last_name?: string | null;
  agent_code?: string | null;
  app_role?: "admin" | "supervisor" | "agent" | null;
  staff_type?: "underwriter" | "sales" | null;
  branch?: { id: number; code: string } | number | null;
  app_active?: boolean | null;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value: string | undefined | null): value is string {
  return !!value && UUID_RE.test(value);
}

function fileObj(row: DxRequestFileRow): DxFileObj | null {
  const f = row.file;
  if (!f) return null;
  if (typeof f === "string") return { id: f, filename_download: "", type: "", filesize: 0 };
  return f;
}

function agentCodeFromUuid(uuid: string | null | undefined): { code: string; name: string } {
  if (!uuid) return { code: "", name: "" };
  const a = getAgentsCache().find((x) => x.userId === uuid);
  return { code: a?.id ?? uuid, name: a?.name ?? uuid };
}
function uuidFromAgentCode(code: string | undefined): string | null {
  if (!code) return null;
  if (isUuid(code)) return code;
  const a = getAgentsCache().find((x) => x.id === code || x.userId === code);
  return a?.userId ?? null;
}
function agentLookupName(u: DxAgentLookupRow): string {
  const joined = `${u.first_name ?? ""} ${u.last_name ?? ""}`.trim();
  return joined || u.agent_code || u.id;
}
function agentLookupBranchCode(u: DxAgentLookupRow): string {
  const b = u.branch;
  if (b && typeof b === "object" && "code" in b) return b.code ?? "";
  return "";
}
function agentLookupBranchId(u: DxAgentLookupRow): number | null {
  const b = u.branch;
  if (typeof b === "number") return b;
  if (b && typeof b === "object" && "id" in b) return b.id ?? null;
  return null;
}
function branchCodeFromId(id: number | null | undefined): string {
  if (id == null) return "";
  return getBranchesCache().find((b) => b.id === id)?.code ?? "";
}
function branchIdFromCode(code: string | undefined | null): number | null {
  if (!code) return null;
  return getBranchesCache().find((b) => b.code === code)?.id ?? null;
}

export type ResolvedUploadAgent = {
  userId: string;
  agentCode: string;
  name: string;
  branchCode: string;
  branchId: number | null;
  staffType?: "underwriter" | "sales";
  source: "cache" | "direct-user-id" | "direct-agent-code" | "raw-uuid";
};

export async function dxResolveUploadAgent(identifier: string): Promise<ResolvedUploadAgent> {
  await ensureEntitiesCached();
  const key = identifier.trim();
  const cached = getAgentsCache().find((a) => a.id === key || a.userId === key);
  if (cached) {
    return {
      userId: cached.userId,
      agentCode: cached.id,
      name: cached.name,
      branchCode: cached.branch ?? "",
      branchId: branchIdFromCode(cached.branch),
      staffType: cached.staffType,
      source: "cache",
    };
  }

  const fields = "id,first_name,last_name,agent_code,app_role,staff_type,branch.id,branch.code,app_active";
  let row: DxAgentLookupRow | undefined;
  let source: ResolvedUploadAgent["source"] = "direct-agent-code";
  if (isUuid(key)) {
    try {
      const r = await dxRequest<{ data: DxAgentLookupRow }>(`/users/${encodeURIComponent(key)}?fields=${fields}`);
      row = r.data;
      source = "direct-user-id";
    } catch (e) {
      console.warn("[upload debug] direct user-id agent lookup failed", { agentParam: key, error: e });
    }
  }
  if (!row) {
    try {
      const r = await dxRequest<{ data: DxAgentLookupRow[] }>(
        `/users?fields=${fields}&limit=1&filter[_or][0][id][_eq]=${encodeURIComponent(key)}&filter[_or][1][agent_code][_eq]=${encodeURIComponent(key)}`,
      );
      row = r.data[0];
      source = row?.id === key ? "direct-user-id" : "direct-agent-code";
    } catch (e) {
      console.warn("[upload debug] agent-code lookup failed", { agentParam: key, error: e });
    }
  }

  if (row) {
    if (row.app_role && row.app_role !== "agent") throw new Error("Upload link does not point to an agent user");
    if (row.app_active === false) throw new Error("Upload link points to an inactive agent user");
    const branchCode = agentLookupBranchCode(row);
    return {
      userId: row.id,
      agentCode: row.agent_code || row.id,
      name: agentLookupName(row),
      branchCode,
      branchId: agentLookupBranchId(row) ?? branchIdFromCode(branchCode),
      staffType: row.staff_type ?? undefined,
      source,
    };
  }

  if (isUuid(key)) {
    return { userId: key, agentCode: key, name: key, branchCode: "", branchId: null, source: "raw-uuid" };
  }
  throw new Error("Sales Agent not found for this upload link");
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

function buildImages(files: DxRequestFileRow[]): DemoRequest["images"] {
  const byKind = (k: RequestFileKind) =>
    files
      .filter((f) => f.kind === k)
      .sort((a, b) => (a.uploaded_at ?? "").localeCompare(b.uploaded_at ?? ""));

  const urls = (rows: DxRequestFileRow[]) => rows.map((r) => dxAssetUrl(fileObj(r)?.id ?? ""));

  const inspectionRow = byKind("inspection")[0];
  const vehicleImages = byKind("vehicle_image").map((r) => ({
    kind: "image" as const,
    url: dxAssetUrl(fileObj(r)?.id ?? ""),
  }));
  const vehicleVideos = byKind("vehicle_video").map((r) => {
    const f = fileObj(r);
    return {
      kind: "video" as const,
      name: f?.filename_download ?? "video",
      size: f?.filesize ?? 0,
      type: f?.type ?? "video/*",
    };
  });
  const attachments = byKind("attachment").map((r) => {
    const f = fileObj(r);
    return {
      name: f?.filename_download ?? "file",
      type: f?.type ?? "",
      size: f?.filesize ?? 0,
      url: dxAssetUrl(f?.id ?? ""),
    };
  });
  const missingAttachments = byKind("missing_attachment").map((r) => {
    const f = fileObj(r);
    return {
      name: f?.filename_download ?? "file",
      type: f?.type ?? "",
      size: f?.filesize ?? 0,
      url: dxAssetUrl(f?.id ?? ""),
    };
  });

  return {
    registration: urls(byKind("registration")),
    license: urls(byKind("license")),
    emirates: urls(byKind("emirates")),
    vehicleMedia: [...vehicleImages, ...vehicleVideos],
    inspection: inspectionRow ? dxAssetUrl(fileObj(inspectionRow)?.id ?? "") : undefined,
    attachments,
    ...(missingAttachments.length ? { missingAttachments } : {}),
  };
}

function buildQuotes(files: DxRequestFileRow[]): DemoQuote[] {
  return files
    .filter((f) => f.kind === "quote")
    .sort((a, b) => (a.uploaded_at ?? "").localeCompare(b.uploaded_at ?? ""))
    .map((row) => {
      const f = fileObj(row);
      const uploader = agentCodeFromUuid(row.uploaded_by);
      return {
        id: row.id, // request_files row id (used for delete)
        name: f?.filename_download ?? "quote",
        type: f?.type ?? "",
        size: f?.filesize ?? 0,
        url: dxAssetUrl(f?.id ?? ""),
        uploadedByUserId: row.uploaded_by ?? "",
        uploadedByName: uploader.name,
        uploadedAt: row.uploaded_at ?? new Date().toISOString(),
      };
    });
}

function requestFromRow(
  r: DxRequestRow,
  notes: DxNoteRow[],
  fileRows: DxRequestFileRow[],
): DemoRequest {
  const agent = agentCodeFromUuid(r.agent);
  const origin = r.origin_agent ? agentCodeFromUuid(r.origin_agent) : null;
  const myFiles = fileRows.filter((f) => f.request === r.id);
  return {
    id: r.id,
    uuid: r.uuid ?? r.id.toLowerCase(),
    agentId: agent.code,
    agentUserId: r.agent ?? undefined,
    agentName: agent.name,
    originAgentId: origin?.code,
    originAgentUserId: r.origin_agent ?? undefined,
    originAgentName: origin?.name,
    assignedAt: r.assigned_at ?? undefined,
    branch: branchCodeFromId(r.branch),
    status: r.status,
    createdAt: r.date_created ?? new Date().toISOString(),
    customerName: r.customer_name ?? undefined,
    customerEmail: r.customer_email ?? undefined,
    customerPhone: r.customer_phone ?? undefined,
    notes: notes.filter((n) => n.request === r.id).map(noteFromRow),
    images: buildImages(myFiles),
    quotes: buildQuotes(myFiles),
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
const FILE_FIELDS =
  "id,request,kind,uploaded_by,uploaded_at,file.id,file.filename_download,file.type,file.filesize";

export async function dxListRequests(opts?: { agentUuid?: string; branchId?: number }): Promise<DemoRequest[]> {
  await ensureEntitiesCached();
  const andClauses: unknown[] = [];
  if (opts?.agentUuid) {
    andClauses.push({
      _or: [
        { agent: { _eq: opts.agentUuid } },
        { origin_agent: { _eq: opts.agentUuid } },
      ],
    });
  }
  if (opts?.branchId != null) {
    andClauses.push({ branch: { _eq: opts.branchId } });
  }
  const filterObj = andClauses.length ? { _and: andClauses } : undefined;
  const qs =
    `?fields=${REQ_FIELDS}&limit=-1&sort=-date_created` +
    (filterObj ? `&filter=${encodeURIComponent(JSON.stringify(filterObj))}` : "");
  const url = `/items/requests${qs}`;
  console.info("[agent dashboard debug] dxListRequests URL", url);
  const r = await dxRequest<{ data: DxRequestRow[] }>(url);
  console.info("[agent dashboard debug] dxListRequests raw rows", r.data.map((x) => ({ id: x.id, agent: x.agent, origin_agent: x.origin_agent, branch: x.branch })));
  const ids = r.data.map((x) => x.id);
  let notes: DxNoteRow[] = [];
  let files: DxRequestFileRow[] = [];
  if (ids.length) {
    const idsParam = ids.map(encodeURIComponent).join(",");
    try {
      const [nr, fr] = await Promise.all([
        dxRequest<{ data: DxNoteRow[] }>(`/items/request_notes?fields=${NOTE_FIELDS}&limit=-1&filter[request][_in]=${idsParam}`),
        dxRequest<{ data: DxRequestFileRow[] }>(`/items/request_files?fields=${FILE_FIELDS}&limit=-1&filter[request][_in]=${idsParam}`),
      ]);
      notes = nr.data;
      files = fr.data;
    } catch (e) {
      console.warn("[agent dashboard debug] request related rows failed; showing request rows only", e);
    }
  }
  const list = r.data.map((row) => requestFromRow(row, notes, files));
  // Newest-first using max(createdAt, assignedAt) for reassignments
  const ts = (x: DemoRequest) => (x.assignedAt && x.assignedAt > x.createdAt ? x.assignedAt : x.createdAt);
  list.sort((a, b) => (ts(a) < ts(b) ? 1 : -1));
  return list;
}

export async function dxGetRequest(id: string): Promise<DemoRequest | null> {
  await ensureEntitiesCached();
  // Try direct lookup by primary key first (fast path for REQ-... ids).
  let row: DxRequestRow | undefined;
  try {
    const direct = await dxRequest<{ data: DxRequestRow }>(
      `/items/requests/${encodeURIComponent(id)}?fields=${REQ_FIELDS}`,
    );
    row = direct.data;
  } catch {
    // Fall back to lookup by id OR uuid (handles legacy rows w/ uuid key).
    try {
      const filter = `filter[_or][0][id][_eq]=${encodeURIComponent(id)}&filter[_or][1][uuid][_eq]=${encodeURIComponent(id.toLowerCase())}`;
      const r = await dxRequest<{ data: DxRequestRow[] }>(`/items/requests?fields=${REQ_FIELDS}&limit=1&${filter}`);
      row = r.data[0];
    } catch (e) {
      console.error("dxGetRequest failed", id, e);
      return null;
    }
  }
  if (!row) return null;
  const [nr, fr] = await Promise.all([
    dxRequest<{ data: DxNoteRow[] }>(
      `/items/request_notes?fields=${NOTE_FIELDS}&limit=-1&sort=date_created&filter[request][_eq]=${encodeURIComponent(row.id)}`,
    ),
    dxRequest<{ data: DxRequestFileRow[] }>(
      `/items/request_files?fields=${FILE_FIELDS}&limit=-1&sort=uploaded_at&filter[request][_eq]=${encodeURIComponent(row.id)}`,
    ),
  ]);
  return requestFromRow(row, nr.data, fr.data);
}

// ---------------- mutations ----------------

export type DxCreateRequestInput = {
  id: string;
  uuid: string;
  agentCode: string;
  agentUserId?: string;
  branchCode: string;
  branchId?: number | null;
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
};

export async function dxCreateRequest(input: DxCreateRequestInput): Promise<DemoRequest> {
  await ensureEntitiesCached();
  const agentUuid = input.agentUserId ?? uuidFromAgentCode(input.agentCode);
  const branchId = input.branchId ?? branchIdFromCode(input.branchCode);
  if (!agentUuid) throw new Error("Agent not found");
  const body: Record<string, unknown> = {
    id: input.id,
    status: "new",
    customer_name: input.customerName ?? null,
    customer_email: input.customerEmail ?? null,
    customer_phone: input.customerPhone ?? null,
  };
  body.agent = agentUuid;
  body.origin_agent = agentUuid;
  if (branchId != null) body.branch = branchId;
  console.info("[upload debug] dxCreateRequest body", {
    createdRequestId: input.id,
    createdRequestAgent: body.agent,
    createdRequestOriginAgent: body.origin_agent,
    createdRequestBranch: body.branch ?? null,
    agentCodeInput: input.agentCode,
    branchCodeInput: input.branchCode,
  });
  const r = await dxRequest<{ data: DxRequestRow }>(
    `/items/requests?fields=${REQ_FIELDS}`,
    { method: "POST", body: JSON.stringify(body) },
  );
  emit();
  return requestFromRow(r.data, [], []);
}

export async function dxPatchRequest(id: string, patch: Record<string, unknown>): Promise<DemoRequest> {
  const r = await dxRequest<{ data: DxRequestRow }>(
    `/items/requests/${encodeURIComponent(id)}?fields=${REQ_FIELDS}`,
    { method: "PATCH", body: JSON.stringify(patch) },
  );
  const [nr, fr] = await Promise.all([
    dxRequest<{ data: DxNoteRow[] }>(
      `/items/request_notes?fields=${NOTE_FIELDS}&limit=-1&sort=date_created&filter[request][_eq]=${encodeURIComponent(id)}`,
    ),
    dxRequest<{ data: DxRequestFileRow[] }>(
      `/items/request_files?fields=${FILE_FIELDS}&limit=-1&sort=uploaded_at&filter[request][_eq]=${encodeURIComponent(id)}`,
    ),
  ]);
  emit();
  return requestFromRow(r.data, nr.data, fr.data);
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

// ---------------- file uploads (Phase 3d) ----------------

/**
 * Upload a single file to Directus `/files` and create a matching
 * `request_files` row.
 */
export async function dxAttachFile(
  requestId: string,
  file: File,
  kind: RequestFileKind,
  uploadedByUuid?: string | null,
): Promise<DxRequestFileRow> {
  const uploaded = await dxUploadFile(file);
  const body: Record<string, unknown> = {
    request: requestId,
    file: uploaded.id,
    kind,
    uploaded_at: new Date().toISOString(),
  };
  if (uploadedByUuid) body.uploaded_by = uploadedByUuid;
  const r = await dxRequest<{ data: DxRequestFileRow }>(
    `/items/request_files?fields=${FILE_FIELDS}`,
    { method: "POST", body: JSON.stringify(body) },
  );
  return r.data;
}

/**
 * Upload many files of the SAME kind sequentially so that read-back ordering
 * (by `uploaded_at`) matches the order callers passed them in. Use this for
 * front/back-style kinds (registration, license, emirates). For unordered
 * kinds (attachment, missing_attachment, quote) parallel upload is fine.
 */
export async function dxAttachFilesSequential(
  requestId: string,
  files: File[],
  kind: RequestFileKind,
  uploadedByUuid?: string | null,
): Promise<DxRequestFileRow[]> {
  const out: DxRequestFileRow[] = [];
  for (const f of files) out.push(await dxAttachFile(requestId, f, kind, uploadedByUuid));
  return out;
}

export async function dxAttachFilesParallel(
  requestId: string,
  files: File[],
  kind: RequestFileKind,
  uploadedByUuid?: string | null,
): Promise<DxRequestFileRow[]> {
  return Promise.all(files.map((f) => dxAttachFile(requestId, f, kind, uploadedByUuid)));
}

export async function dxDeleteRequestFile(rowId: string, opts?: { deleteAsset?: boolean }): Promise<void> {
  // Read row first so we can drop the underlying file asset if requested.
  let fileId: string | undefined;
  if (opts?.deleteAsset) {
    try {
      const r = await dxRequest<{ data: DxRequestFileRow }>(
        `/items/request_files/${encodeURIComponent(rowId)}?fields=file.id`,
      );
      const f = r.data.file;
      fileId = typeof f === "string" ? f : f?.id;
    } catch { /* tolerate */ }
  }
  await dxRequest(`/items/request_files/${encodeURIComponent(rowId)}`, { method: "DELETE" });
  if (fileId) {
    try { await dxRequest(`/files/${encodeURIComponent(fileId)}`, { method: "DELETE" }); }
    catch { /* ignore — orphan file is harmless */ }
  }
}