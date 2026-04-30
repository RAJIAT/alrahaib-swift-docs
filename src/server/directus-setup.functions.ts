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

    // 0. Verify token
    const me = await call(base, token, "GET", "/users/me");
    if (!me.ok) {
      return {
        success: false,
        error: `Cannot authenticate (HTTP ${me.status}). Check the URL and token.`,
        steps,
      };
    }
    steps.push({ step: "Verify token", ok: true, detail: me.data?.data?.email ?? "ok" });

    // 1. Create requests collection
    await run("Create collection: requests", () =>
      call(base, token, "POST", "/collections", {
        collection: "requests",
        meta: {
          icon: "description",
          note: "Insurance requests submitted by customers",
          display_template: "{{customer_name}} — {{status}}",
          sort_field: "date_created",
        },
        schema: { name: "requests" },
      }),
    );

    // 2. id (UUID PK)
    await run("Field: id (UUID)", () =>
      call(base, token, "POST", "/fields/requests", {
        field: "id",
        type: "uuid",
        meta: { hidden: true, readonly: true, interface: "input", special: ["uuid"] },
        schema: { is_primary_key: true, has_auto_increment: false },
      }),
    );

    // 3. date_created
    await run("Field: date_created", () =>
      call(base, token, "POST", "/fields/requests", {
        field: "date_created",
        type: "timestamp",
        meta: { special: ["date-created"], interface: "datetime", readonly: true, hidden: true },
        schema: {},
      }),
    );

    // 4. status with choices
    await run("Field: status (dropdown)", () =>
      call(base, token, "POST", "/fields/requests", {
        field: "status",
        type: "string",
        meta: {
          interface: "select-dropdown",
          options: {
            choices: [
              { text: "New", value: "new" },
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

    // 5. Plain string fields
    const stringFields = [
      "agent_id", "agent_name", "branch",
      "customer_name", "customer_email", "customer_phone",
      "missing_attachments",
    ];
    for (const f of stringFields) {
      await run(`Field: ${f}`, () =>
        call(base, token, "POST", "/fields/requests", {
          field: f,
          type: "string",
          meta: { interface: "input" },
          schema: {},
        }),
      );
    }

    // 6. File fields (M2O → directus_files)
    const fileFields = ["registration", "license", "emirates", "passport"];
    for (const f of fileFields) {
      await run(`Field: ${f} (file)`, () =>
        call(base, token, "POST", "/fields/requests", {
          field: f,
          type: "uuid",
          meta: { interface: "file", special: ["file"] },
          schema: {},
        }),
      );
      await run(`Relation: ${f} → directus_files`, () =>
        call(base, token, "POST", "/relations", {
          collection: "requests",
          field: f,
          related_collection: "directus_files",
        }),
      );
    }

    // 7. vehicle_photos M2M
    await run("Field: vehicle_photos (alias)", () =>
      call(base, token, "POST", "/fields/requests", {
        field: "vehicle_photos",
        type: "alias",
        meta: { interface: "files", special: ["files"] },
      }),
    );

    await run("Junction collection: requests_files", () =>
      call(base, token, "POST", "/collections", {
        collection: "requests_files",
        meta: { hidden: true, icon: "import_export" },
        schema: { name: "requests_files" },
      }),
    );

    await run("Junction field: id", () =>
      call(base, token, "POST", "/fields/requests_files", {
        field: "id",
        type: "integer",
        meta: { hidden: true },
        schema: { is_primary_key: true, has_auto_increment: true },
      }),
    );
    await run("Junction field: requests_id", () =>
      call(base, token, "POST", "/fields/requests_files", {
        field: "requests_id", type: "uuid", schema: {},
      }),
    );
    await run("Junction field: directus_files_id", () =>
      call(base, token, "POST", "/fields/requests_files", {
        field: "directus_files_id", type: "uuid", schema: {},
      }),
    );

    await run("Relation: junction → requests", () =>
      call(base, token, "POST", "/relations", {
        collection: "requests_files",
        field: "requests_id",
        related_collection: "requests",
        meta: { one_field: "vehicle_photos", junction_field: "directus_files_id" },
      }),
    );
    await run("Relation: junction → files", () =>
      call(base, token, "POST", "/relations", {
        collection: "requests_files",
        field: "directus_files_id",
        related_collection: "directus_files",
        meta: { junction_field: "requests_id" },
      }),
    );

    // 8. Custom user fields
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

    // 9. Public policy
    let policyId: string | null = null;
    const policyRes = await call(base, token, "POST", "/policies", {
      name: "Public Customer Upload",
      icon: "public",
      description: "Anonymous customers can submit insurance requests",
    });
    if (policyRes.ok && policyRes.data?.data?.id) {
      policyId = policyRes.data.data.id;
      steps.push({ step: "Create Public Policy", ok: true, detail: "created" });
    } else {
      // Fetch existing
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

    // 10. Permissions on the policy
    if (policyId) {
      await run("Permission: files create", () =>
        call(base, token, "POST", "/permissions", {
          policy: policyId,
          collection: "directus_files",
          action: "create",
        }),
      );
      await run("Permission: requests create", () =>
        call(base, token, "POST", "/permissions", {
          policy: policyId,
          collection: "requests",
          action: "create",
          fields: [
            "agent_id", "agent_name", "branch",
            "registration", "license", "emirates", "passport",
            "vehicle_photos",
            "customer_name", "customer_email", "customer_phone",
          ],
        }),
      );
      await run("Permission: requests update (limited)", () =>
        call(base, token, "POST", "/permissions", {
          policy: policyId,
          collection: "requests",
          action: "update",
          fields: ["missing_attachments", "registration", "license", "emirates", "passport"],
        }),
      );

      // 11. Attach policy to Public access (Directus 11+ uses access entries, not role.policies)
      // Public access = an access entry with role=null + the policy.
      // First, check if it's already attached to avoid duplicates.
      const existing = await call(
        base, token, "GET",
        `/access?filter[role][_null]=true&filter[policy][_eq]=${policyId}&fields=id&limit=1`,
      );
      if (existing.data?.data?.[0]?.id) {
        steps.push({ step: "Attach policy to Public access", ok: true, detail: "already attached" });
      } else {
        await run("Attach policy to Public access", () =>
          call(base, token, "POST", "/access", {
            role: null,
            user: null,
            policy: policyId,
          }),
        );
      }
    }

    // 12. Agent + Supervisor roles
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
