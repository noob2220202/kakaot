// pm2 실행 설정:  npx pm2 start ecosystem.config.js
module.exports = {
  apps: [
    {
      name: "marae-emoticon",
      script: "server.js",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "300M",
      env: {
        NODE_ENV: "production",
        PORT: 7777,
        // 로컬 전용이면 접속키 불필요. 외부 노출 시에만 주석 해제:
        // ACCESS_KEY: "원하는비밀번호",
      },
    },
  ],
};
