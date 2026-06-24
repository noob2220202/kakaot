const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { chromium } = require("playwright");

const SESSION_PATH = path.join(__dirname, "session.json");

function waitForEnter(message) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(message, () => {
      rl.close();
      resolve();
    });
  });
}

(async () => {
  console.log("브라우저를 열어요. 카카오 계정으로 로그인한 뒤, 이 터미널로 돌아와 Enter를 눌러주세요.");

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("https://e.kakao.com/");

  await waitForEnter("\n로그인을 완료했으면 Enter를 눌러주세요... ");

  const state = await context.storageState();
  fs.writeFileSync(SESSION_PATH, JSON.stringify(state, null, 2));
  console.log(`세션을 저장했어요 → ${SESSION_PATH}`);

  await browser.close();
  process.exit(0);
})().catch((err) => {
  console.error("로그인 중 오류가 발생했어요:", err);
  process.exit(1);
});
