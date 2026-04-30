-- Audit log schema (run when moving from demo to real backend).
-- Mirrors src/services/audit.ts so the migration is straightforward.

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  ts timestamptz not null default now(),
  actor_id uuid,
  actor_name text,
  actor_role text not null check (actor_role in ('admin','supervisor','agent','anonymous')),
  actor_branch text,
  action text not null,
  entity_type text not null check (entity_type in ('request','agent','auth')),
  entity_id text,
  entity_label text,
  branch text,
  before jsonb,
  after jsonb,
  meta jsonb
);

create index if not exists audit_logs_ts_idx on public.audit_logs (ts desc);
create index if not exists audit_logs_branch_idx on public.audit_logs (branch);
create index if not exists audit_logs_entity_idx on public.audit_logs (entity_type, entity_id);

alter table public.audit_logs enable row level security;

-- Admins can read everything.
create policy "Admins read audit"
  on public.audit_logs for select
  to authenticated
  using (public.has_role(auth.uid(), 'admin'));

-- Supervisors can read entries for their branch only.
-- (Branch comes from the supervisor's profile; adjust the join to your schema.)
create policy "Supervisors read audit for own branch"
  on public.audit_logs for select
  to authenticated
  using (
    public.has_role(auth.uid(), 'supervisor')
    and branch = (select branch from public.agents where user_id = auth.uid() limit 1)
  );

-- Inserts are done from server-side code (service role) — no public insert policy.
