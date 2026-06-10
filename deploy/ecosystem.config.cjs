// PM2 process file — Ubuntu 26.04 + Node 20 + Nginx reverse proxy
// Usage on server:
//   mkdir -p logs
//   pm2 start ecosystem.config.cjs --env production
//   pm2 save && sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u $USER --hp $HOME
module.exports = {
  apps: [
    {
      name: "aldiplomacy-portal",
      script: ".output/server/index.mjs",
      cwd: __dirname,
      instances: 1,                 // bump to "max" only after load testing
      exec_mode: "fork",
      max_memory_restart: "512M",
      autorestart: true,
      watch: false,
      time: true,
      kill_timeout: 8000,           // allow graceful shutdown (SIGINT -> SIGKILL)
      wait_ready: false,
      listen_timeout: 10000,
      env: {
        NODE_ENV: "production",
        PORT: 3000,
        HOST: "127.0.0.1",          // loopback only; Nginx fronts public traffic
      },
      env_production: {
        NODE_ENV: "production",
        PORT: 3000,
        HOST: "127.0.0.1",
      },
      out_file: "./logs/out.log",
      error_file: "./logs/err.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      merge_logs: true,
    },
  ],
};