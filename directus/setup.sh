#!/usr/bin/env bash
# ============================================================
#  Directus setup — Al Rahaib Insurance
#  Run: chmod +x setup.sh && ./setup.sh
# ============================================================
set -e

# ---------- Config ----------
BASE="${DIRECTUS_URL:-http://74.162.122.193:8055}"
TOKEN="${DIRECTUS_TOKEN:-Ku-owyi9r8CzuyI8SlIHTqPD2Yu04OKp}"

AUTH=(-H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json")

say() { printf "\n\033[1;36m==> %s\033[0m\n" "$1"; }
ok()  { printf "   \033[1;32m✓\033[0m %s\n" "$1"; }
warn(){ printf "   \033[1;33m!\033[0m %s\n" "$1"; }

# ---------- 0. Ping ----------
say "Checking Directus connection ($BASE)"
curl -sf "${AUTH[@]}" "$BASE/users/me" >/dev/null && ok "Token valid" || { echo "❌ Invalid token / URL"; exit 1; }

# ============================================================
# 1. COLLECTION: requests
# ============================================================
say "Creating collection: requests"
curl -s -X POST "$BASE/collections" "${AUTH[@]}" -d '{
  "collection": "requests",
  "meta": {
    "icon": "description",
    "note": "Insurance requests submitted by customers",
    "display_template": "{{customer_name}} — {{status}}",
    "sort_field": "date_created"
  },
  "schema": { "name": "requests" }
}' >/dev/null 2>&1 && ok "requests created" || warn "exists or skipped"

# id (UUID PK)
curl -s -X POST "$BASE/fields/requests" "${AUTH[@]}" -d '{
  "field":"id","type":"uuid",
  "meta":{"hidden":true,"readonly":true,"interface":"input","special":["uuid"]},
  "schema":{"is_primary_key":true,"has_auto_increment":false}
}' >/dev/null 2>&1 && ok "id" || warn "id exists"

# date_created
curl -s -X POST "$BASE/fields/requests" "${AUTH[@]}" -d '{
  "field":"date_created","type":"timestamp",
  "meta":{"special":["date-created"],"interface":"datetime","readonly":true,"hidden":true},
  "schema":{}
}' >/dev/null 2>&1 && ok "date_created" || warn "date_created exists"

# status (with choices)
curl -s -X POST "$BASE/fields/requests" "${AUTH[@]}" -d '{
  "field":"status","type":"string",
  "meta":{
    "interface":"select-dropdown",
    "options":{"choices":[
      {"text":"New","value":"new"},
      {"text":"Processing","value":"processing"},
      {"text":"Reupload Requested","value":"reupload"},
      {"text":"Sold","value":"sold"},
      {"text":"Rejected","value":"rejected"}
    ]},
    "display":"labels"
  },
  "schema":{"default_value":"new","is_nullable":false}
}' >/dev/null 2>&1 && ok "status" || warn "status exists"

# Plain string fields
for f in agent_id agent_name branch customer_name customer_email customer_phone missing_attachments; do
  curl -s -X POST "$BASE/fields/requests" "${AUTH[@]}" -d "{
    \"field\":\"$f\",\"type\":\"string\",
    \"meta\":{\"interface\":\"input\"},
    \"schema\":{}
  }" >/dev/null 2>&1 && ok "$f" || warn "$f exists"
done

# File fields (M2O → directus_files)
for f in registration license emirates passport; do
  curl -s -X POST "$BASE/fields/requests" "${AUTH[@]}" -d "{
    \"field\":\"$f\",\"type\":\"uuid\",
    \"meta\":{\"interface\":\"file\",\"special\":[\"file\"]},
    \"schema\":{}
  }" >/dev/null 2>&1 && ok "$f (file)" || warn "$f exists"

  curl -s -X POST "$BASE/relations" "${AUTH[@]}" -d "{
    \"collection\":\"requests\",\"field\":\"$f\",
    \"related_collection\":\"directus_files\"
  }" >/dev/null 2>&1 && ok "relation $f → files" || warn "relation $f exists"
done

# vehicle_photos (M2M → directus_files via junction)
curl -s -X POST "$BASE/fields/requests" "${AUTH[@]}" -d '{
  "field":"vehicle_photos","type":"alias",
  "meta":{"interface":"files","special":["files"]}
}' >/dev/null 2>&1 && ok "vehicle_photos (files M2M)" || warn "vehicle_photos exists"

# Junction collection for M2M
curl -s -X POST "$BASE/collections" "${AUTH[@]}" -d '{
  "collection":"requests_files",
  "meta":{"hidden":true,"icon":"import_export"},
  "schema":{"name":"requests_files"}
}' >/dev/null 2>&1 && ok "junction created" || warn "junction exists"

curl -s -X POST "$BASE/fields/requests_files" "${AUTH[@]}" -d '{
  "field":"id","type":"integer",
  "meta":{"hidden":true},
  "schema":{"is_primary_key":true,"has_auto_increment":true}
}' >/dev/null 2>&1
curl -s -X POST "$BASE/fields/requests_files" "${AUTH[@]}" -d '{
  "field":"requests_id","type":"uuid","schema":{}
}' >/dev/null 2>&1
curl -s -X POST "$BASE/fields/requests_files" "${AUTH[@]}" -d '{
  "field":"directus_files_id","type":"uuid","schema":{}
}' >/dev/null 2>&1

curl -s -X POST "$BASE/relations" "${AUTH[@]}" -d '{
  "collection":"requests_files","field":"requests_id",
  "related_collection":"requests",
  "meta":{"one_field":"vehicle_photos","junction_field":"directus_files_id"}
}' >/dev/null 2>&1
curl -s -X POST "$BASE/relations" "${AUTH[@]}" -d '{
  "collection":"requests_files","field":"directus_files_id",
  "related_collection":"directus_files",
  "meta":{"junction_field":"requests_id"}
}' >/dev/null 2>&1
ok "M2M relations wired"

# ============================================================
# 2. CUSTOM USER FIELDS (agent_id, branch on directus_users)
# ============================================================
say "Adding custom fields to directus_users"
for spec in 'agent_id|Agent ID' 'branch|Branch'; do
  field="${spec%%|*}"
  label="${spec##*|}"
  curl -s -X POST "$BASE/fields/directus_users" "${AUTH[@]}" -d "{
    \"field\":\"$field\",\"type\":\"string\",
    \"meta\":{\"interface\":\"input\",\"note\":\"$label\"},
    \"schema\":{}
  }" >/dev/null 2>&1 && ok "users.$field" || warn "users.$field exists"
done

# ============================================================
# 3. PUBLIC POLICY (anonymous customer can create requests)
# ============================================================
say "Creating Public Access Policy"
POLICY_RES=$(curl -s -X POST "$BASE/policies" "${AUTH[@]}" -d '{
  "name":"Public Customer Upload",
  "icon":"public","description":"Anonymous customers can submit insurance requests"
}')
POLICY_ID=$(echo "$POLICY_RES" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')

if [ -z "$POLICY_ID" ]; then
  # Already exists — fetch it
  POLICY_ID=$(curl -s "${AUTH[@]}" "$BASE/policies?filter[name][_eq]=Public+Customer+Upload" \
    | sed -n 's/.*"id":"\([^"]*\)".*/\1/p' | head -1)
  warn "policy exists ($POLICY_ID)"
else
  ok "policy created ($POLICY_ID)"
fi

# Permissions: create files + create requests + update missing_attachments only
say "Granting public permissions"
curl -s -X POST "$BASE/permissions" "${AUTH[@]}" -d "{
  \"policy\":\"$POLICY_ID\",\"collection\":\"directus_files\",\"action\":\"create\"
}" >/dev/null 2>&1 && ok "files: create"

curl -s -X POST "$BASE/permissions" "${AUTH[@]}" -d "{
  \"policy\":\"$POLICY_ID\",\"collection\":\"requests\",\"action\":\"create\",
  \"fields\":[\"agent_id\",\"agent_name\",\"branch\",\"registration\",\"license\",\"emirates\",\"passport\",\"vehicle_photos\",\"customer_name\",\"customer_email\",\"customer_phone\"]
}" >/dev/null 2>&1 && ok "requests: create"

# Allow updating ONLY missing_attachments (for re-upload link)
curl -s -X POST "$BASE/permissions" "${AUTH[@]}" -d "{
  \"policy\":\"$POLICY_ID\",\"collection\":\"requests\",\"action\":\"update\",
  \"fields\":[\"missing_attachments\",\"registration\",\"license\",\"emirates\",\"passport\"]
}" >/dev/null 2>&1 && ok "requests: update (limited fields)"

# Attach policy to Public role
say "Attaching policy to Public role"
PUBLIC_ROLE=$(curl -s "${AUTH[@]}" "$BASE/roles?filter[name][_eq]=Public&fields=id,name" \
  | sed -n 's/.*"id":"\([^"]*\)".*/\1/p' | head -1)

if [ -n "$PUBLIC_ROLE" ]; then
  curl -s -X PATCH "$BASE/roles/$PUBLIC_ROLE" "${AUTH[@]}" \
    -d "{\"policies\":[\"$POLICY_ID\"]}" >/dev/null && ok "attached to Public role"
else
  warn "Public role not found — Directus 11+ uses public_registration; attach manually if needed"
fi

# ============================================================
# 4. AGENT & SUPERVISOR ROLES
# ============================================================
say "Creating Agent & Supervisor roles"
for role in Agent Supervisor; do
  curl -s -X POST "$BASE/roles" "${AUTH[@]}" -d "{
    \"name\":\"$role\",\"icon\":\"badge\",\"description\":\"$role role\"
  }" >/dev/null 2>&1 && ok "$role" || warn "$role exists"
done

echo
echo "============================================================"
echo "✅ Directus setup completed!"
echo "============================================================"
echo "Next steps:"
echo "  1. Open: $BASE/admin → Settings → Roles & Permissions"
echo "  2. Verify the 'Public Customer Upload' policy is attached to Public"
echo "  3. Configure RLS filters on Agent role:"
echo "     requests.read → { \"agent_id\": { \"_eq\": \"\$CURRENT_USER.agent_id\" } }"
echo "  4. Set in your frontend .env:"
echo "     VITE_DIRECTUS_URL=$BASE"
echo "============================================================"
