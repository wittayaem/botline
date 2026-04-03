module.exports = {
  apps: [{
    name: 'botline',
    script: 'dist/index.js',
    cwd: '/www/wwwroot/botline',   // ← เปลี่ยนตาม path บน server
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '300M',
    env: {
      NODE_ENV: 'production',
    },
    error_file: './logs/pm2-error.log',
    out_file:   './logs/pm2-out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
  }],
};
