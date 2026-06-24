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
        // 기본은 127.0.0.1(로컬 전용). 다른 PC/휴대폰에서 접속하려면 아래 줄의
        // 주석을 풀고 `npm run restart`로 반영하세요.
        // HOST: "0.0.0.0",
      },
    },
  ],
};
