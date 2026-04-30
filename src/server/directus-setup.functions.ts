import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const Input = z.object({
  url: z.string().url().refine((v) => v.startsWith("http://") || v.startsWith("https://")),
  token: z.string().min(10).max(200),
});

type StepResult = { step: string; ok: boolean; detail?: string };

async function call(
  base: string,
  token: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ ok: boolean; status: number; data: any; text: string }> {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text().catch(() => "");
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* ignore */ }
  return { ok: res.ok, status: res.status, data, text };
}

/**
 * Server function — runs the full Directus setup.
 * Idempotent: existing items return 400/409 and we treat them as "already exists".
 *
 * Creates collections:
 *  - requests (main insurance request)
 *  - request_notes (comments / missing-doc requests on a request)
 *  - request_vehicle_media (junction: request → file, with kind: image|video)
 *  - request_attachments (junction: request → file, generic attachments)
 *  - request_missing_attachments (junction: request → file, customer reupload)
 *  - requests_files (junction for legacy vehicle_photos M2M, kept for back-compat)
 *  - agents (agent directory — separate from auth users)
 *  - audit_log (who did what and when)
 *
 * Creates roles: Agent, Supervisor
 * Creates a Public access policy that lets anonymous customers upload files
 * and submit/update their own request via the customer reupload link.
 */
export const setupDirectus = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => Input.parse(data))
  .handler(async ({ data }) => {
    const base = data.url.replace(/\/$/, "");
    const token = data.token;
    const steps: StepResult[] = [];

    const run = async (label: string, fn: () => Promise<{ ok: boolean; status: number; text: string }>) => {
      try {
        const r = await fn();
        // 200/204 = ok, 400/409 = already exists (idempotent)
        const idempotent = r.status === 400 || r.status === 409;
        steps.push({
          step: label,
          ok: r.ok || idempotent,
          detail: r.ok ? "created" : idempotent ? "already exists" : `HTTP ${r.status}`,
        });
      } catch (e: any) {
        steps.push({ step: label, ok: false, detail: e?.message ?? "network error" });
      }
    };

    // ---------------- Helpers ----------------

    const createCollection = (name: string, opts: { hidden?: boolean; icon?: string; note?: string; sortField?: string } = {}) =>
      run(`Create collection: ${name}`, () =>
        call(base, token, "POST", "/collections", {
          collection: name,
          meta: {
            hidden: opts.hidden ?? false,
            icon: opts.icon ?? "folder",
            note: opts.note,
            sort_field: opts.sortField,
          },
          schema: { name },
        }),
      );

    const createUuidPk = (collection: string) =>
      run(`Field: ${collection}.id (UUID PK)`, () =>
        call(base, token, "POST", `/fields/${collection}`, {
          field: "id",
          type: "uuid",
          meta: { hidden: true, readonly: true, interface: "input", special: ["uuid"] },
          schema: { is_primary_key: true, has_auto_increment: false },
        }),
      );

    const createDateCreated = (collection: string) =>
      run(`Field: ${collection}.date_created`, () =>
        call(base, token, "POST", `/fields/${collection}`, {
          field: "date_created",
          type: "timestamp",
          meta: { special: ["date-created"], interface: "datetime", readonly: true, hidden: true },
          schema: {},
        }),
      );

    const createStringField = (collection: string, field: string, extra: { interface?: string; options?: any; default?: any; nullable?: boolean } = {}) =>
      run(`Field: ${collection}.${field}`, () =>
        call(base, token, "POST", `/fields/${collection}`, {
          field,
          type: "string",
          meta: { interface: extra.interface ?? "input", options: extra.options },
          schema: {
            default_value: extra.default,
            is_nullable: extra.nullable ?? true,
          },
        }),
      );

    const createTextField = (collection: string, field: string) =>
      run(`Field: ${collection}.${field} (text)`, () =>
        call(base, token, "POST", `/fields/${collection}`, {
          field,
          type: "text",
          meta: { interface: "input-multiline" },
          schema: {},
        }),
      );

    const createTimestampField = (collection: string, field: string) =>
      run(`Field: ${collection}.${field} (timestamp)`, () =>
        call(base, token, "POST", `/fields/${collection}`, {
          field,
          type: "timestamp",
          meta: { interface: "datetime" },
          schema: {},
        }),
      );

    const createBooleanField = (collection: string, field: string, def = true) =>
      run(`Field: ${collection}.${field} (bool)`, () =>
        call(base, token, "POST", `/fields/${collection}`, {
          field,
          type: "boolean",
          meta: { interface: "boolean" },
          schema: { default_value: def },
        }),
      );

    const createJsonField = (collection: string, field: string) =>
      run(`Field: ${collection}.${field} (json)`, () =>
        call(base, token, "POST", `/fields/${collection}`, {
          field,
          type: "json",
          meta: { interface: "input-code", options: { language: "json" } },
          schema: {},
        }),
      );

    const createFileM2O = (collection: string, field: string) => async () => {
      await run(`Field: ${collection}.${field} (file)`, () =>
        call(base, token, "POST", `/fields/${collection}`, {
          field,
          type: "uuid",
          meta: { interface: "file", special: ["file"] },
          schema: {},
        }),
      );
      await run(`Relation: ${collection}.${field} → files`, () =>
        call(base, token, "POST", "/relations", {
          collection,
          field,
          related_collection: "directus_files",
        }),
      );
    };

    const createM2O = (collection: string, field: string, related: string) => async () => {
      await run(`Field: ${collection}.${field} → ${related}`, () =>
        call(base, token, "POST", `/fields/${collection}`, {
          field,
          type: "uuid",
          meta: { interface: "select-dropdown-m2o" },
          schema: {},
        }),
      );
      await run(`Relation: ${collection}.${field} → ${related}`, () =>
        call(base, token, "POST", "/relations", {
          collection,
          field,
          related_collection: related,
        }),
      );
    };

    // ---------------- 0. Verify token ----------------
    const me = await call(base, token, "GET", "/users/me");
    if (!me.ok) {
      return {
        success: false,
        error: `Cannot authenticate (HTTP ${me.status}). Check the URL and token.`,
        steps,
      };
    }
    steps.push({ step: "Verify token", ok: true, detail: me.data?.data?.email ?? "ok" });

    // ===========================================================
    // 1. REQUESTS collection
    // ===========================================================

    await createCollection("requests", {
      icon: "description",
      note: "Insurance requests submitted by customers",
      sortField: "date_created",
    });
    await createUuidPk("requests");
    await createDateCreated("requests");

    // human-readable display id (REQ-1001)
    await createStringField("requests", "request_display_id");

    // status dropdown
    await run("Field: requests.status (dropdown)", () =>
      call(base, token, "POST", "/fields/requests", {
        field: "status",
        type: "string",
        meta: {
          interface: "select-dropdown",
          options: {
            choices: [
              { text: "New", value: "new" },
              { text: "Link Sent", value: "linkSent" },
              { text: "Processing", value: "processing" },
              { text: "Reupload Requested", value: "reupload" },
              { text: "Sold", value: "sold" },
              { text: "Rejected", value: "rejected" },
            ],
          },
          display: "labels",
        },
        schema: { default_value: "new", is_nullable: false },
      }),
    );

    // Plain string fields
    for (const f of [
      "agent_id",
      "agent_name",
      "branch",
      "customer_name",
      "customer_email",
      "customer_phone",
    ]) {
      await createStringField("requests", f);
    }

    // Single-file fields (registration/license/emirates can be 1-2 files each;
    // we keep a primary file here AND a junction for the rest).
    // For backwards compatibility with existing directus.ts we keep the
    // single-file M2O AND add junctions below for multi-file support.
    for (const f of ["registration", "license", "emirates", "passport", "inspection"]) {
      await createFileM2O("requests", f)();
    }

    // ===========================================================
    // 2. requests_files (junction for vehicle_photos M2M — legacy)
    // Kept for back-compat with existing dxCreateRequest code.
    // ===========================================================

    await run("Field: requests.vehicle_photos (alias)", () =>
      call(base, token, "POST", "/fields/requests", {
        field: "vehicle_photos",
        type: "alias",
        meta: { interface: "files", special: ["files"] },
      }),
    );

    await createCollection("requests_files", { hidden: true, icon: "import_export" });
    await run("Field: requests_files.id", () =>
      call(base, token, "POST", "/fields/requests_files", {
        field: "id", type: "integer",
        meta: { hidden: true },
        schema: { is_primary_key: true, has_auto_increment: true },
      }),
    );
    await run("Field: requests_files.requests_id", () =>
      call(base, token, "POST", "/fields/requests_files", {
        field: "requests_id", type: "uuid", schema: {},
      }),
    );
    await run("Field: requests_files.directus_files_id", () =>
      call(base, token, "POST", "/fields/requests_files", {
        field: "directus_files_id", type: "uuid", schema: {},
      }),
    );
    await run("Relation: requests_files → requests", () =>
      call(base, token, "POST", "/relations", {
        collection: "requests_files",
        field: "requests_id",
        related_collection: "requests",
        meta: { one_field: "vehicle_photos", junction_field: "directus_files_id" },
      }),
    );
    await run("Relation: requests_files → files", () =>
      call(base, token, "POST", "/relations", {
        collection: "requests_files",
        field: "directus_files_id",
        related_collection: "directus_files",
        meta: { junction_field: "requests_id" },
      }),
    );

    // ===========================================================
    // 3. request_vehicle_media (vehicle photos + videos with kind)
    // ===========================================================

    await createCollection("request_vehicle_media", {
      icon: "perm_media",
      note: "Vehicle photos and videos attached to a request",
    });
    await createUuidPk("request_vehicle_media");
    await createDateCreated("request_vehicle_media");
    await createM2O("request_vehicle_media", "request", "requests")();
    await createFileM2O("request_vehicle_media", "file")();
    await run("Field: request_vehicle_media.kind", () =>
      call(base, token, "POST", "/fields/request_vehicle_media", {
        field: "kind",
        type: "string",
        meta: {
          interface: "select-dropdown",
          options: {
            choices: [
              { text: "Image", value: "image" },
              { text: "Video", value: "video" },
            ],
          },
        },
        schema: { default_value: "image", is_nullable: false },
      }),
    );
    // Add inverse alias on requests
    await run("Field: requests.vehicle_media (O2M alias)", () =>
      call(base, token, "POST", "/fields/requests", {
        field: "vehicle_media",
        type: "alias",
        meta: { interface: "list-o2m", special: ["o2m"] },
      }),
    );
    await run("Relation: request_vehicle_media.request inverse", () =>
      call(base, token, "PATCH", "/relations/request_vehicle_media/request", {
        meta: { one_field: "vehicle_media" },
      }),
    );

    // ===========================================================
    // 4. request_attachments (generic attachments)
    // ===========================================================

    await createCollection("request_attachments", {
      icon: "attachment",
      note: "Free-form attachments (PDFs, images, docs) on a request",
    });
    await createUuidPk("request_attachments");
    await createDateCreated("request_attachments");
    await createM2O("request_attachments", "request", "requests")();
    await createFileM2O("request_attachments", "file")();
    await createStringField("request_attachments", "original_name");
    await run("Field: requests.attachments (O2M alias)", () =>
      call(base, token, "POST", "/fields/requests", {
        field: "attachments",
        type: "alias",
        meta: { interface: "list-o2m", special: ["o2m"] },
      }),
    );
    await run("Relation: request_attachments.request inverse", () =>
      call(base, token, "PATCH", "/relations/request_attachments/request", {
        meta: { one_field: "attachments" },
      }),
    );

    // ===========================================================
    // 5. request_missing_attachments (customer reuploads)
    // ===========================================================

    await createCollection("request_missing_attachments", {
      icon: "upload_file",
      note: "Files customers re-upload via the missing-docs link",
    });
    await createUuidPk("request_missing_attachments");
    await createDateCreated("request_missing_attachments");
    await createM2O("request_missing_attachments", "request", "requests")();
    await createFileM2O("request_missing_attachments", "file")();
    await createStringField("request_missing_attachments", "original_name");
    await run("Field: requests.missing_attachments (O2M alias)", () =>
      call(base, token, "POST", "/fields/requests", {
        field: "missing_attachments",
        type: "alias",
        meta: { interface: "list-o2m", special: ["o2m"] },
      }),
    );
    await run("Relation: request_missing_attachments.request inverse", () =>
      call(base, token, "PATCH", "/relations/request_missing_attachments/request", {
        meta: { one_field: "missing_attachments" },
      }),
    );

    // ===========================================================
    // 6. request_notes (comments + missing-doc requests)
    // ===========================================================

    await createCollection("request_notes", {
      icon: "comment",
      note: "Comments and missing-document requests on a request",
      sortField: "date_created",
    });
    await createUuidPk("request_notes");
    await createDateCreated("request_notes");
    await createM2O("request_notes", "request", "requests")();
    await createTextField("request_notes", "text");
    await run("Field: request_notes.kind", () =>
      call(base, token, "POST", "/fields/request_notes", {
        field: "kind",
        type: "string",
        meta: {
          interface: "select-dropdown",
          options: {
            choices: [
              { text: "Comment", value: "comment" },
              { text: "Missing Document", value: "missing" },
            ],
          },
        },
        schema: { default_value: "comment", is_nullable: false },
      }),
    );
    await createStringField("request_notes", "author_id");
    await createStringField("request_notes", "author_name");
    await createStringField("request_notes", "author_role");
    await createTimestampField("request_notes", "resolved_at");
    await run("Field: requests.notes (O2M alias)", () =>
      call(base, token, "POST", "/fields/requests", {
        field: "notes",
        type: "alias",
        meta: { interface: "list-o2m", special: ["o2m"] },
      }),
    );
    await run("Relation: request_notes.request inverse", () =>
      call(base, token, "PATCH", "/relations/request_notes/request", {
        meta: { one_field: "notes" },
      }),
    );

    // ===========================================================
    // 7. agents (agent directory — separate from login users)
    // ===========================================================

    await createCollection("agents", {
      icon: "badge",
      note: "Agent directory (may or may not have a login user)",
    });
    // text PK so we can use friendly ids like A001
    await run("Field: agents.id (string PK)", () =>
      call(base, token, "POST", "/fields/agents", {
        field: "id",
        type: "string",
        meta: { interface: "input", readonly: false },
        schema: { is_primary_key: true },
      }),
    );
    await createDateCreated("agents");
    await createStringField("agents", "name");
    await createStringField("agents", "email");
    await createStringField("agents", "branch");
    await createBooleanField("agents", "active", true);
    await run("Field: agents.role", () =>
      call(base, token, "POST", "/fields/agents", {
        field: "role",
        type: "string",
        meta: {
          interface: "select-dropdown",
          options: {
            choices: [
              { text: "Agent", value: "agent" },
              { text: "Supervisor", value: "supervisor" },
            ],
          },
        },
        schema: { default_value: "agent", is_nullable: false },
      }),
    );
    await createStringField("agents", "supervisor_id");
    await createStringField("agents", "user_id"); // optional link to directus_users.id

    // ===========================================================
    // 8. audit_log
    // ===========================================================

    await createCollection("audit_log", {
      icon: "history",
      note: "Audit trail — who did what and when",
      sortField: "ts",
    });
    await createUuidPk("audit_log");
    await run("Field: audit_log.ts", () =>
      call(base, token, "POST", "/fields/audit_log", {
        field: "ts",
        type: "timestamp",
        meta: { special: ["date-created"], interface: "datetime", readonly: true },
        schema: {},
      }),
    );
    await createStringField("audit_log", "actor_id");
    await createStringField("audit_log", "actor_name");
    await createStringField("audit_log", "actor_role");
    await createStringField("audit_log", "actor_branch");
    await createStringField("audit_log", "action");
    await createStringField("audit_log", "entity_type");
    await createStringField("audit_log", "entity_id");
    await createStringField("audit_log", "entity_label");
    await createStringField("audit_log", "branch");
    await createJsonField("audit_log", "before");
    await createJsonField("audit_log", "after");
    await createJsonField("audit_log", "meta");

    // ===========================================================
    // 9. Custom user fields (so directus_users can act as agents)
    // ===========================================================

    for (const f of ["agent_id", "branch"]) {
      await run(`User field: ${f}`, () =>
        call(base, token, "POST", "/fields/directus_users", {
          field: f,
          type: "string",
          meta: { interface: "input" },
          schema: {},
        }),
      );
    }

    // ===========================================================
    // 10. Public access policy (anonymous customer uploads + reupload)
    // ===========================================================

    let policyId: string | null = null;
    const policyRes = await call(base, token, "POST", "/policies", {
      name: "Public Customer Upload",
      icon: "public",
      description: "Anonymous customers can submit insurance requests and reupload missing files",
    });
    if (policyRes.ok && policyRes.data?.data?.id) {
      policyId = policyRes.data.data.id;
      steps.push({ step: "Create Public Policy", ok: true, detail: "created" });
    } else {
      const found = await call(
        base, token, "GET",
        "/policies?filter[name][_eq]=Public+Customer+Upload&fields=id&limit=1",
      );
      policyId = found.data?.data?.[0]?.id ?? null;
      steps.push({
        step: "Create Public Policy",
        ok: !!policyId,
        detail: policyId ? "already exists" : "could not create or fetch",
      });
    }

    if (policyId) {
      // Files: create + read (customers upload; we read their own assets)
      await run("Permission: files create", () =>
        call(base, token, "POST", "/permissions", {
          policy: policyId, collection: "directus_files", action: "create",
        }),
      );
      await run("Permission: files read", () =>
        call(base, token, "POST", "/permissions", {
          policy: policyId, collection: "directus_files", action: "read",
        }),
      );

      // requests: create (initial submit) + update (limited fields for reupload)
      await run("Permission: requests create", () =>
        call(base, token, "POST", "/permissions", {
          policy: policyId, collection: "requests", action: "create",
          fields: [
            "id", "request_display_id",
            "agent_id", "agent_name", "branch",
            "registration", "license", "emirates", "passport", "inspection",
            "vehicle_photos",
            "customer_name", "customer_email", "customer_phone",
          ],
        }),
      );
      await run("Permission: requests update (reupload)", () =>
        call(base, token, "POST", "/permissions", {
          policy: policyId, collection: "requests", action: "update",
          fields: ["status", "registration", "license", "emirates", "passport"],
        }),
      );
      await run("Permission: requests read (reupload page lookup)", () =>
        call(base, token, "POST", "/permissions", {
          policy: policyId, collection: "requests", action: "read",
          fields: ["id", "request_display_id", "status", "customer_name"],
        }),
      );

      // missing attachments: customer creates these on reupload page
      await run("Permission: missing_attachments create", () =>
        call(base, token, "POST", "/permissions", {
          policy: policyId, collection: "request_missing_attachments", action: "create",
        }),
      );
      await run("Permission: vehicle_media create", () =>
        call(base, token, "POST", "/permissions", {
          policy: policyId, collection: "request_vehicle_media", action: "create",
        }),
      );
      await run("Permission: attachments create", () =>
        call(base, token, "POST", "/permissions", {
          policy: policyId, collection: "request_attachments", action: "create",
        }),
      );

      // Attach to Public access (Directus 11+)
      const existing = await call(
        base, token, "GET",
        `/access?filter[role][_null]=true&filter[policy][_eq]=${policyId}&fields=id&limit=1`,
      );
      if (existing.data?.data?.[0]?.id) {
        steps.push({ step: "Attach policy to Public access", ok: true, detail: "already attached" });
      } else {
        await run("Attach policy to Public access", () =>
          call(base, token, "POST", "/access", {
            role: null, user: null, policy: policyId,
          }),
        );
      }
    }

    // ===========================================================
    // 11. Roles: Agent, Supervisor (Admin already exists)
    // ===========================================================

    for (const role of ["Agent", "Supervisor"]) {
      await run(`Create role: ${role}`, () =>
        call(base, token, "POST", "/roles", {
          name: role,
          icon: "badge",
          description: `${role} role`,
        }),
      );
    }

    const failed = steps.filter((s) => !s.ok);
    return {
      success: failed.length === 0,
      total: steps.length,
      ok: steps.length - failed.length,
      failed: failed.length,
      steps,
    };
  });
