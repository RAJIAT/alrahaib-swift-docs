// PM2 process file — DirectAdmin Node.js deployment
// Usage on server:
//   pm2 start ecosystem.config.cjs --env production
//   pm2 save && pm2 startup
module.exports = {
  apps: [
    {
      name: "aldiplomacy-portal",
      script: ".output/server/index.mjs",
      cwd: __dirname,
      instances: 1,                  // bump to "max" only after load testing
      exec_mode: "fork",
      max_memory_restart: "512M",
      autorestart: true,
      watch: false,
      time: true,
      env: {
        NODE_ENV: "production",
        PORT: process.env.PORT || 3000,
      },
      env_production: {
        NODE_ENV: "production",
      },
      out_file: "./logs/out.log",
      error_file: "./logs/err.log",
      merge_logs: true,
    },
  ],
};