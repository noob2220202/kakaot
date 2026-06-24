const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { chromium } = require("playwright");

const SESSION_PATH = path.join(__dirname, "session.json");
const LOGIN_URL = `https://accounts.kakao.com/login?continue=${encodeURIComponent("https://e.kakao.com/")}`;

const ID_SELECTORS = ['#loginId--1', 'input[name="email"]', 'input[type="text"]:visible'];
const PW_SELECTORS = ['#password--2', 'input[name="password"]', 'input[type="password"]:visible'];
const SUBMIT_SELECTORS = ['button.submit', 'button[type="submit"]'];
const EXTRA_INPUT_SELECTOR = 'input[type="text"]:visible, input[type="tel"]:visible, input[type="number"]:visible';
const CONTINUE_SELECTOR = 'button:visible, a:visible';

const CTRL_C = String.fromCharCode(3);
const END_OF_TRANSMISSION = String.fromCharCode(4);
const DELETE_KEY = String.fromCharCode(127);
const BACKSPACE_KEY = String.fromCharCode(8);
const CARRIAGE_RETURN = String.fromCharCode(13);
const NEWLINE = String.fromCharCode(10);

function ask(promptText) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(promptText, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function askHidden(promptText) {
  return new Promise((resolve) => {
    const { stdin } = process;
    process.stdout.write(promptText);
    let value = "";

    const onData = (chunk) => {
      const char = chunk.toString("utf8");

      if (char === NEWLINE || char === CARRIAGE_RETURN || char === END_OF_TRANSMISSION) {
        stdin.setRawMode(false);
        stdin.pause();
        stdin.removeListener("data", onData);
        process.stdout.write(NEWLINE);
        resolve(value);
        return;
      }

      if (char === CTRL_C) {
        process.stdout.write(NEWLINE);
        process.exit(1);
      }

      if (char === DELETE_KEY || char === BACKSPACE_KEY) {
        if (value.length > 0) {
          value = value.slice(0, -1);
          process.stdout.write(BACKSPACE_KEY + " " + BACKSPACE_KEY);
        }
        return;
      }

      value += char;
      process.stdout.write("*");
    };

    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    stdin.on("data", onData);
  });
}

async function waitAndFillFirst(page, selectors, value, options) {
  const retries = (options && options.retries) || 15;
  const delay = (options && options.delay) || 300;
  for (let i = 0; i < retries; i++) {
    for (const sel of selectors) {
      const loc = page.locator(sel).first();
      if (await loc.isVisible().catch(() => false)) {
        await loc.fill(value);
        return true;
      }
    }
    await page.waitForTimeout(delay);
  }
  return false;
}

async function waitAndClickFirst(page, selectors, options) {
  const retries = (options && options.retries) || 5;
  const delay = (options && options.delay) || 300;
  const filterText = options && options.filterText;
  for (let i = 0; i < retries; i++) {
    for (const sel of selectors) {
      let loc = page.locator(sel).first();
      if (filterText) loc = page.locator(sel).filter({ hasText: filterText }).first();
      if (await loc.isVisible().catch(() => false)) {
        await loc.click();
        return true;
      }
    }
    await page.waitForTimeout(delay);
  }
  return false;
}

async function isAnyVisible(page, selectors) {
  for (const sel of selectors) {
    const loc = page.locator(sel).first();
    if (await loc.isVisible().catch(() => false)) return true;
  }
  return false;
}

async function readVisibleErrorText(page) {
  const candidates = ['[class*="error"]:visible', '[class*="msg_error"]:visible', '[role="alert"]:visible'];
  for (const sel of candidates) {
    const loc = page.locator(sel).first();
    if (await loc.isVisible().catch(() => false)) {
      const text = await loc.innerText().catch(() => "");
      if (text && text.trim()) return text.trim();
    }
  }
  return "";
}

async function dumpInputs(page, label) {
  try {
    const inputs = await page.evaluate(() =>
      Array.from(document.querySelectorAll("input")).map((el) => ({
        id: el.id,
        name: el.name,
        type: el.type,
        placeholder: el.placeholder,
        visible: !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length),
      }))
    );
    console.log(`[디버그] ${label} - 현재 URL: ${page.url()}`);
    console.log(`[디버그] 페이지의 input 태그들: ${JSON.stringify(inputs)}`);
  } catch {
    // 진단 실패는 무시하고 계속 진행
  }
}

function isLoggedInUrl(page) {
  const url = page.url();
  return /^https:\/\/([\w-]+\.)?kakao\.com\//.test(url) && !/accounts\.kakao\.com/.test(url);
}

(async () => {
  console.log("카카오 로그인을 진행할게요. 터미널에 아이디 / 비밀번호 / (필요 시) 인증번호를 입력하면 자동으로 로그인을 마칩니다.");
  console.log("");

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();

  try {
    await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded" });
    await dumpInputs(page, "로그인 페이지 로드 직후");

    const email = await ask("카카오 아이디 (이메일 또는 전화번호): ");
    const filledId = await waitAndFillFirst(page, ID_SELECTORS, email);
    if (!filledId) {
      await dumpInputs(page, "아이디 입력란 탐색 실패");
      throw new Error("아이디 입력란을 찾지 못했어요. 카카오 로그인 화면 구조가 바뀌었을 수 있어요.");
    }

    const password = await askHidden("비밀번호: ");
    const filledPw = await waitAndFillFirst(page, PW_SELECTORS, password);
    if (!filledPw) {
      await dumpInputs(page, "비밀번호 입력란 탐색 실패");
      throw new Error("비밀번호 입력란을 찾지 못했어요. 카카오 로그인 화면 구조가 바뀌었을 수 있어요.");
    }

    await waitAndClickFirst(page, SUBMIT_SELECTORS);
    await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
    await dumpInputs(page, "1차 로그인 제출 후");

    // 같은 로그인 폼(아이디+비밀번호 칸)이 여전히 보이면 추가 인증이 아니라 로그인 자체가
    // 실패한 것이므로, 엉뚱한 입력칸을 인증번호로 오인하지 않도록 여기서 멈추고 원인을 보여준다.
    if (!isLoggedInUrl(page) && (await isAnyVisible(page, PW_SELECTORS))) {
      const errorText = await readVisibleErrorText(page);
      console.log("");
      console.log("로그인이 처리되지 않고 같은 화면에 머물러 있어요 (아이디/비밀번호를 다시 확인해주세요).");
      if (errorText) console.log(`화면에 표시된 메시지: ${errorText}`);
    } else {
      // 추가 인증(문자/카카오톡 인증번호 등)이 필요하면 최대 3회까지 터미널에서 입력받아 진행
      for (let attempt = 0; attempt < 3 && !isLoggedInUrl(page); attempt++) {
        if (await isAnyVisible(page, PW_SELECTORS)) break; // 다시 같은 폼으로 돌아온 경우 중단

        const extraInput = page.locator(EXTRA_INPUT_SELECTOR).first();
        if (!(await extraInput.isVisible().catch(() => false))) break;

        console.log("");
        console.log("추가 인증이 필요해요. 문자/카카오톡으로 받은 인증번호 등 화면에서 요구하는 값을 입력해주세요.");
        const code = await ask("입력값: ");
        await extraInput.fill(code);
        await waitAndClickFirst(page, SUBMIT_SELECTORS);
        await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
        await dumpInputs(page, `추가 인증 ${attempt + 1}회차 제출 후`);
      }

      // "계속/확인/동의" 류의 안내 화면이 남아있으면 한 번 더 통과 시도
      if (!isLoggedInUrl(page)) {
        await waitAndClickFirst(page, [CONTINUE_SELECTOR], { retries: 1, filterText: /확인|계속|동의|허용/ });
        await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
      }
    }

    if (!isLoggedInUrl(page)) {
      console.log("");
      console.log("자동으로 로그인 완료를 확인하지 못했어요. 그래도 현재 세션을 저장해 둘게요.");
      console.log("서버를 띄운 뒤 /api/status 로 로그인 여부를 확인해보고, loggedIn이 false면 위 [디버그] 로그를 보고 다시 시도해주세요.");
    } else {
      console.log("");
      console.log("로그인에 성공했어요.");
    }

    const state = await context.storageState();
    fs.writeFileSync(SESSION_PATH, JSON.stringify(state, null, 2));
    console.log(`세션을 저장했어요 -> ${SESSION_PATH}`);
  } finally {
    await browser.close();
  }
})().catch((err) => {
  console.error("로그인 중 오류가 발생했어요:", err.message || err);
  process.exit(1);
});
