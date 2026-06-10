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
  DemoNote,
  DemoQuote,
  DemoRequest,
  DemoStatus,
} from "./demoStore";

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
  const filters: string[] = [];
  if (opts?.agentUuid) {
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
  let files: DxRequestFileRow[] = [];
  if (ids.length) {
    const idsParam = ids.map(encodeURIComponent).join(",");
    const [nr, fr] = await Promise.all([
      dxRequest<{ data: DxNoteRow[] }>(`/items/request_notes?fields=${NOTE_FIELDS}&limit=-1&filter[request][_in]=${idsParam}`),
      dxRequest<{ data: DxRequestFileRow[] }>(`/items/request_files?fields=${FILE_FIELDS}&limit=-1&filter[request][_in]=${idsParam}`),
    ]);
    notes = nr.data;
    files = fr.data;
  }
  const list = r.data.map((row) => requestFromRow(row, notes, files));
  // Newest-first using max(createdAt, assignedAt) for reassignments
  const ts = (x: DemoRequest) => (x.assignedAt && x.assignedAt > x.createdAt ? x.assignedAt : x.createdAt);
  list.sort((a, b) => (ts(a) < ts(b) ? 1 : -1));
  return list;
}

export async function dxGetRequest(id: string): Promise<DemoRequest | null> {
  await ensureEntitiesCached();
  const filter = `filter[_or][0][id][_eq]=${encodeURIComponent(id)}&filter[_or][1][uuid][_eq]=${encodeURIComponent(id.toLowerCase())}`;
  const r = await dxRequest<{ data: DxRequestRow[] }>(`/items/requests?fields=${REQ_FIELDS}&limit=1&${filter}`);
  const row = r.data[0];
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