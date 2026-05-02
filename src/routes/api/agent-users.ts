import { createFileRoute } from "@tanstack/react-router";

const DIRECTUS_TARGET = process.env.DIRECTUS_TARGET || "http://api.rajiatiyah.com:8055";

type Actor = {
  id: string;
  role: "admin" | "supervisor" | "agent";
  branch: string | null;
};

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
  if (!response.ok) throw new Error(`${response.status}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : {};
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

  const response = await fetch(
    `${DIRECTUS_TARGET}/users/me?fields=id,branch,role,role.name`,
    { headers: { Authorization: auth } },
  );
  if (!response.ok) return null;

  const json = (await response.json()) as { data?: { id?: string; branch?: string | null; role?: string | { name?: string } } };
  const user = json.data;
  if (!user?.id) return null;

  const rawRoleName = typeof user.role === "object" ? user.role?.name : typeof user.role === "string" ? await roleNameFromId(user.role) : null;
  const normalized = (rawRoleName ?? "").toLowerCase();
  const role: Actor["role"] = normalized.includes("admin")
    ? "admin"
    : normalized.includes("supervisor")
      ? "supervisor"
      : "agent";

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
          if (!actor || (actor.role !== "admin" && actor.role !== "supervisor")) {
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

          const roleName = requestedRole === "supervisor" ? "Supervisor" : "Agent";
          const roleId = await ensureRole(roleName);
          const branch = actor.role === "supervisor" ? actor.branch : (body.branch ?? null);
          if (actor.role === "supervisor" && !branch) {
            return jsonError(400, "Supervisor branch is missing");
          }

          const created = await adminDx("/users", {
            method: "POST",
            body: JSON.stringify({
              email: body.email,
              password: body.password,
              first_name: body.first_name,
              last_name: body.last_name ?? "",
              agent_id: body.agent_id,
              branch,
              supervisor_id: requestedRole === "agent" ? (body.supervisor_id ?? (actor.role === "supervisor" ? actor.id : null)) : null,
              role: roleId,
              status: "active",
            }),
          });

          return Response.json({ ok: true, data: created.data }, { headers: { "cache-control": "no-store" } });
        } catch (error) {
          console.error("[agent-users] create failed", error);
          return jsonError(502, "Agent creation failed on the server");
        }
      },
    },
  },
});