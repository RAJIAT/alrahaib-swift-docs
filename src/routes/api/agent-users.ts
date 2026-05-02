import { createFileRoute } from "@tanstack/react-router";

const DIRECTUS_TARGET = process.env.DIRECTUS_TARGET || "http://api.rajiatiyah.com:8055";

type Actor = {
  id: string;
  role: "admin" | "supervisor" | "agent";
  branch: string | null;
};

class DirectusAdminError extends Error {
  status: number;
  body: string;

  constructor(status: number, body: string) {
    super(`${status}: ${body.slice(0, 200)}`);
    this.status = status;
    this.body = body;
  }
}

async function adminDx<T = any>(path: string, init: RequestInit = {}): Promise<{ data?: T }> {
  const token = process.env.DIRECTUS_ADMIN_TOKEN;
  if (!token) throw new Error("Admin token is not configured");

  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  if (!headers.has("Content-Type") && !(init.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`${DIRECTUS_TARGET}${path}`, { ...init, headers });
  const text = await response.text();
  if (!response.ok) throw new DirectusAdminError(response.status, text);
  return text ? JSON.parse(text) : {};
}

async function ensureUsersField(field: string, definition: Record<string, any>): Promise<boolean> {
  try {
    await adminDx(`/fields/directus_users/${field}`);
    return true;
  } catch (error) {
    if (!(error instanceof DirectusAdminError) || error.status !== 404) {
      console.error(`[agent-users] failed checking field ${field}`, error);
      return false;
    }
  }

  try {
    await adminDx("/fields/directus_users", {
      method: "POST",
      body: JSON.stringify(definition),
    });
    return true;
  } catch (error) {
    console.error(`[agent-users] failed creating field ${field}`, error);
    return false;
  }
}

async function ensureAgentUserFields(): Promise<Set<string>> {
  const entries: Array<[string, Record<string, any>]> = [
    [
      "agent_id",
      {
        field: "agent_id",
        type: "string",
        meta: { interface: "input", note: "Public agent identifier", width: "half" },
        schema: { is_nullable: true, is_unique: false },
      },
    ],
    [
      "branch",
      {
        field: "branch",
        type: "string",
        meta: { interface: "input", note: "Branch", width: "half" },
        schema: { is_nullable: true },
      },
    ],
    [
      "supervisor_id",
      {
        field: "supervisor_id",
        type: "uuid",
        meta: {
          interface: "select-dropdown-m2o",
          note: "Supervising user (for agents)",
          width: "half",
          special: ["m2o"],
          options: { template: "{{first_name}} {{last_name}}" },
        },
        schema: { is_nullable: true, foreign_key_table: "directus_users", foreign_key_column: "id" },
      },
    ],
  ];

  const ready = new Set<string>();
  for (const [field, definition] of entries) {
    if (await ensureUsersField(field, definition)) ready.add(field);
  }
  return ready;
}

async function roleNameFromId(roleId: string): Promise<string | null> {
  try {
    const role = await adminDx<{ name?: string }>(`/roles/${encodeURIComponent(roleId)}?fields=name`);
    return role.data?.name ?? null;
  } catch {
    return null;
  }
}

async function resolveActor(request: Request): Promise<Actor | null> {
  const auth = request.headers.get("authorization");
  if (!auth?.toLowerCase().startsWith("bearer ")) return null;

  const response = await fetch(`${DIRECTUS_TARGET}/users/me?fields=id`, {
    headers: { Authorization: auth },
  });
  if (!response.ok) {
    console.warn("[agent-users] /users/me failed", response.status);
    return null;
  }

  const json = (await response.json()) as { data?: { id?: string } };
  const verified = json.data;
  if (!verified?.id) return null;

  // After the bearer token proves the caller's identity, use the admin token
  // to read role + branch. Supervisor policies can hide `role`/`branch` from
  // /users/me, which previously made valid supervisors look like agents here.
  const userResponse = await adminDx<{ id?: string; branch?: string | null; role?: string | { name?: string } }>(
    `/users/${encodeURIComponent(verified.id)}?fields=id,branch,role.name`,
  );
  const user = userResponse.data;
  if (!user?.id) return null;

  const rawRoleName = typeof user.role === "object" ? user.role?.name : typeof user.role === "string" ? await roleNameFromId(user.role) : null;
  const normalized = (rawRoleName ?? "").toLowerCase();
  const role: Actor["role"] = normalized.includes("admin")
    ? "admin"
    : normalized.includes("supervisor")
      ? "supervisor"
      : "agent";

  console.log("[agent-users] resolved actor", { id: user.id, role, branch: user.branch ?? null, rawRoleName });
  return { id: user.id, role, branch: user.branch ?? null };
}

async function ensureRole(name: "Agent" | "Supervisor"): Promise<string> {
  const existing = await adminDx<Array<{ id: string }>>(
    `/roles?filter[name][_eq]=${encodeURIComponent(name)}&fields=id&limit=1`,
  );
  const id = existing.data?.[0]?.id;
  if (id) return id;

  const created = await adminDx<{ id?: string }>("/roles", {
    method: "POST",
    body: JSON.stringify({
      name,
      icon: "supervised_user_circle",
      description: `${name} role (auto-created)`,
    }),
  });
  if (!created.data?.id) throw new Error(`Could not create ${name} role`);
  return created.data.id;
}

function jsonError(status: number, error: string) {
  return Response.json({ ok: false, error }, { status });
}

export const Route = createFileRoute("/api/agent-users")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const actor = await resolveActor(request);
          if (!actor) {
            console.warn("[agent-users] no actor resolved from token");
            return jsonError(401, "Your session is invalid. Please sign in again.");
          }
          if (actor.role !== "admin" && actor.role !== "supervisor") {
            console.warn("[agent-users] actor role not allowed:", actor.role);
            return jsonError(403, "You are not allowed to create agents");
          }

          const body = (await request.json()) as Partial<{
            email: string;
            password: string;
            first_name: string;
            last_name: string;
            agent_id: string;
            branch: string | null;
            role: "agent" | "supervisor";
            supervisor_id: string | null;
          }>;

          if (!body.email || !body.password || !body.first_name || !body.agent_id) {
            return jsonError(400, "Missing required agent fields");
          }
          if (body.password.length < 6) return jsonError(400, "Password must be at least 6 characters");

          const requestedRole = body.role === "supervisor" ? "supervisor" : "agent";
          if (actor.role === "supervisor" && requestedRole !== "agent") {
            return jsonError(403, "Supervisors can only create agents");
          }

          // Branch resolution:
          //  - Supervisors: forced to their own branch (must exist on their account)
          //  - Admins: must explicitly choose a branch for both agents and supervisors
          let branch: string | null;
          if (actor.role === "supervisor") {
            if (!actor.branch) {
              console.warn("[agent-users] supervisor", actor.id, "has no branch set");
              return jsonError(400, "Your account has no branch assigned. Ask an admin to set your branch first.");
            }
            branch = actor.branch;
          } else {
            branch = body.branch ?? null;
            if (!branch) {
              return jsonError(400, "Branch is required");
            }
          }

          const roleName = requestedRole === "supervisor" ? "Supervisor" : "Agent";
          const roleId = await ensureRole(roleName);

          const availableUserFields = await ensureAgentUserFields();
          const userPayload: Record<string, unknown> = {
            email: body.email,
            password: body.password,
            first_name: body.first_name,
            last_name: body.last_name ?? "",
            role: roleId,
            status: "active",
          };
          if (availableUserFields.has("agent_id")) userPayload.agent_id = body.agent_id;
          if (availableUserFields.has("branch")) userPayload.branch = branch;
          if (availableUserFields.has("supervisor_id")) {
            userPayload.supervisor_id = requestedRole === "agent"
              ? (body.supervisor_id ?? (actor.role === "supervisor" ? actor.id : null))
              : null;
          }

          const created = await adminDx("/users", {
            method: "POST",
            body: JSON.stringify(userPayload),
          });

          return Response.json({ ok: true, data: created.data }, { headers: { "cache-control": "no-store" } });
        } catch (error) {
          console.error("[agent-users] create failed", error);
          return jsonError(502, error instanceof Error ? error.message : "Agent creation failed on the server");
        }
      },
    },
  },
});