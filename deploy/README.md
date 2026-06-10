# Deployment — Ubuntu 26.04 + Node 20 + Nginx + PM2 + Directus + PostgreSQL

All commands assume the deploy user is `deploy` and the app lives at
`/home/deploy/aldiplomacy-portal`. Adjust paths to match your server.

---

## 1. One-time server preparation

```bash
# System packages
sudo apt update && sudo apt -y upgrade
sudo apt -y install nginx postgresql postgresql-contrib certbot python3-certbot-nginx \
                    git curl ufw build-essential

# PM2
sudo npm install -g pm2

# Firewall
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw --force enable

# PostgreSQL: create role + DBs for Directus
sudo -u postgres psql <<'SQL'
CREATE ROLE directus WITH LOGIN PASSWORD 'CHANGE_ME_STRONG';
CREATE DATABASE directus OWNER directus;
SQL
```

## 2. Directus (self-hosted, separate process on 127.0.0.1:8055)

```bash
mkdir -p ~/directus && cd ~/directus
npm init -y
npm install directus
# Create .env (DB url, KEY, SECRET, STORAGE_LOCATIONS=local, STORAGE_LOCAL_ROOT=./uploads, PORT=8055)
npx directus bootstrap
pm2 start "npx directus start" --name directus
pm2 save
```

Then load schema/seed once `scripts/directus-bootstrap.ts` is finalised:

```bash
DIRECTUS_URL=https://directus.alrahaib.com \
DIRECTUS_ADMIN_TOKEN=<token> \
node scripts/directus-bootstrap.mjs
```

## 3. App deployment

```bash
# Pull / upload code
cd /home/deploy/aldiplomacy-portal
git pull         # or rsync from CI artifact

# Install deps & build
npm ci
cp .env.example .env       # first time only — then edit secrets
npm run build              # outputs to .output/

# First start
mkdir -p logs
pm2 start ecosystem.config.cjs --env production
pm2 save
sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u deploy --hp /home/deploy
```

Subsequent deploys:

```bash
cd /home/deploy/aldiplomacy-portal
git pull
npm ci --omit=dev=false
npm run build
pm2 reload aldiplomacy-portal     # zero-downtime, sends SIGINT for graceful shutdown
```

## 4. Nginx + SSL

```bash
sudo cp deploy/nginx.conf /etc/nginx/sites-available/docportal.alrahaib.com
sudo ln -sf /etc/nginx/sites-available/docportal.alrahaib.com /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d docportal.alrahaib.com -d directus.alrahaib.com
```

## 5. Health check

```bash
curl -fsS https://docportal.alrahaib.com/api/health
# => {"status":"ok","uptime":...,"timestamp":"..."}
```

Wire this URL into UptimeRobot / BetterStack / `pm2 monit`.

## 6. Logs

```bash
pm2 logs aldiplomacy-portal           # live
tail -f logs/out.log logs/err.log     # files
pm2 install pm2-logrotate             # one-time, rotates & compresses
```

## 7. Graceful shutdown

`pm2 reload` and `pm2 stop` send `SIGINT` first, then `SIGKILL` after
`kill_timeout` (8 s, set in `ecosystem.config.cjs`). The Node HTTP server
drains in-flight requests within that window. No application changes
required — TanStack Start's Node adapter handles signal propagation.

## 8. Rollback

Tag every release before deploy:

```bash
# during deploy
RELEASE=$(date +%Y%m%d-%H%M%S)
cp -r .output ../releases/$RELEASE
ln -sfn ../releases/$RELEASE .output-current

# rollback
cd /home/deploy/aldiplomacy-portal
ls -1t ../releases | head -5            # pick previous tag
rm -rf .output && cp -r ../releases/<TAG> .output
pm2 reload aldiplomacy-portal
```

Database rollback: restore from the nightly `pg_dump` (configure cron):

```bash
# nightly backup (crontab -e)
0 3 * * * pg_dump -U directus directus | gzip > /home/deploy/backups/directus-$(date +\%F).sql.gz

# restore
gunzip -c /home/deploy/backups/directus-YYYY-MM-DD.sql.gz | psql -U directus directus
```

Uploaded files: rsync `~/directus/uploads/` to backup target nightly.

## 9. Troubleshooting

| Symptom                       | Check                                                        |
| ----------------------------- | ------------------------------------------------------------ |
| 502 from Nginx                | `pm2 status` — is app running on 127.0.0.1:3000?             |
| App crashes on start          | `pm2 logs aldiplomacy-portal --err --lines 200`              |
| Directus 500 on upload        | `~/directus/uploads/` writable? client_max_body_size in nginx? |
| SSR errors after deploy       | `.env` populated? `SESSION_SECRET` set? rebuild needed       |
| CORS errors from frontend     | Directus `CORS_ORIGIN` must list `https://docportal.alrahaib.com` |