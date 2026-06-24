const http = require("http");
const fs = require("fs");
const path = require("path");
const { Readable } = require("stream");
const archiver = require("archiver");

const PORT = process.env.PORT || 7777;
const HOST = "127.0.0.1";
const SESSION_PATH = path.join(__dirname, "session.json");
const PUBLIC_DIR = path.join(__dirname, "public");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
};

// ---- 카카오 키 파싱 / 이미지 URL 수집 ----------------------------------

function parseKey(input) {
  input = (input || "").trim();
  const m = input.match(/e\.kakao\.com\/(?:t|items)\/([A-Za-z0-9_-]+)/);
  if (m) return m[1];
  if (/^[A-Za-z0-9_-]+$/.test(input)) return input;
  return null;
}

function collectUrls(obj, set) {
  if (obj == null) return;
  if (typeof obj === "string") {
    if (/^https?:\/\/[^"\s]+\.(png|webp|gif|jpg|jpeg)(\?[^"\s]*)?$/i.test(obj)) set.add(obj);
    return;
  }
  if (Array.isArray(obj)) return obj.forEach((v) => collectUrls(v, set));
  if (typeof obj === "object") Object.values(obj).forEach((v) => collectUrls(v, set));
}

function extractTitle(json, fallback) {
  const candidates = ["title", "name", "itemName", "productName"];
  for (const c of candidates) {
    if (typeof json?.[c] === "string" && json[c].trim()) return json[c].trim();
  }
  return fallback;
}

// ---- 세션 / 쿠키 --------------------------------------------------------

function readSession() {
  try {
    return JSON.parse(fs.readFileSync(SESSION_PATH, "utf8"));
  } catch {
    return null;
  }
}

function getSessionCookie() {
  const s = readSession();
  if (!s) return "";
  return (s.cookies || [])
    .filter((c) => /\.?kakao\.com$/i.test(c.domain)) // kakao.com 도메인 쿠키만
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
}

function isLoggedIn() {
  const s = readSession();
  if (!s) return false;
  const cookies = (s.cookies || []).filter((c) => /\.?kakao\.com$/i.test(c.domain));
  if (cookies.length === 0) return false;
  const now = Date.now() / 1000;
  return cookies.some((c) => c.expires === -1 || c.expires > now);
}

// ---- 안전한 다운로드 호스트 ----------------------------------------------

function isKakaoHost(u) {
  try {
    return /(^|\.)(kakao\.com|kakaocdn\.net|daumcdn\.net)$/i.test(new URL(u).hostname);
  } catch {
    return false;
  }
}

function sanitizeFilename(name) {
  return String(name).replace(/[\\/:*?"<>|]+/g, "_").trim().slice(0, 80) || "emoticon";
}

function contentDisposition(filename) {
  const ascii = filename.replace(/[^\x20-\x7E]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

function extOf(url, fallback) {
  const m = url.match(/\.(png|webp|gif|jpe?g)(\?|$)/i);
  return (m ? m[1] : fallback).toLowerCase();
}

// ---- HTTP 유틸 -----------------------------------------------------------

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(body);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 10 * 1024 * 1024) {
        reject(new Error("payload too large"));
        req.destroy();
        return;
      }
      data += chunk;
    });
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        resolve({});
      }
    });
    req.on("error", reject);
  });
}

function serveStatic(req, res, pathname) {
  const rel = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("Not found");
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { "Content-Type": MIME_TYPES[ext] || "application/octet-stream" });
    res.end(data);
  });
}

// ---- API 핸들러 ----------------------------------------------------------

async function handleExtract(req, res) {
  const body = await readJsonBody(req);
  const key = parseKey(body.input);
  if (!key) {
    return sendJson(res, 400, {
      error: "링크를 못 읽었어요. e.kakao.com/t/... 형태인지 확인해 주세요.",
    });
  }

  const apiUrl = `https://e.kakao.com/api/v1/items/t/${key}`;
  const cookie = getSessionCookie();

  let json;
  try {
    const upstream = await fetch(apiUrl, {
      headers: {
        ...(cookie ? { Cookie: cookie } : {}),
        "User-Agent": "Mozilla/5.0",
        Referer: `https://e.kakao.com/t/${key}`,
      },
    });
    if (!upstream.ok) {
      return sendJson(res, 404, {
        error: "이모티콘 정보를 찾을 수 없어요. 링크를 다시 확인해 주세요.",
      });
    }
    json = await upstream.json();
  } catch {
    return sendJson(res, 502, {
      error: "카카오 서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.",
    });
  }

  const urls = new Set();
  collectUrls(json, urls);
  const all = [...urls];
  const animated = all.filter((u) => /\.(webp|gif)(\?|$)/i.test(u));
  const stills = all.filter((u) => /\.(png|jpe?g)(\?|$)/i.test(u));
  const title = extractTitle(json, key);

  sendJson(res, 200, { title, animated, stills, loggedIn: isLoggedIn() });
}

async function handleDownload(req, res, searchParams) {
  const url = searchParams.get("url");
  if (!url || !isKakaoHost(url)) {
    return sendJson(res, 400, { error: "허용되지 않은 URL이에요." });
  }

  try {
    const upstream = await fetch(url);
    if (!upstream.ok || !upstream.body) {
      res.writeHead(502, { "Content-Type": "application/json; charset=utf-8" });
      return res.end(JSON.stringify({ error: "다운로드에 실패했어요." }));
    }
    const base = path.basename(new URL(url).pathname) || `image.${extOf(url, "png")}`;
    res.writeHead(200, {
      "Content-Type": upstream.headers.get("content-type") || "application/octet-stream",
      "Content-Disposition": contentDisposition(base),
    });
    Readable.fromWeb(upstream.body).pipe(res);
  } catch {
    res.writeHead(502, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "다운로드에 실패했어요." }));
  }
}

async function handleDownloadZip(req, res) {
  const body = await readJsonBody(req);
  const urls = Array.isArray(body.urls) ? body.urls.filter((u) => typeof u === "string" && isKakaoHost(u)) : [];
  const name = sanitizeFilename(body.name || "emoticon");

  if (urls.length === 0) {
    return sendJson(res, 400, { error: "다운로드할 이미지가 없어요." });
  }

  res.writeHead(200, {
    "Content-Type": "application/zip",
    "Content-Disposition": contentDisposition(`${name}.zip`),
  });

  const archive = archiver("zip", { zlib: { level: 0 } });
  archive.on("error", () => res.end());
  archive.pipe(res);

  const used = new Set();
  let i = 0;
  for (const url of urls) {
    i++;
    try {
      const upstream = await fetch(url);
      if (!upstream.ok || !upstream.body) continue;
      const buf = Buffer.from(await upstream.arrayBuffer());
      let entryName = path.basename(new URL(url).pathname) || `image-${i}.${extOf(url, "bin")}`;
      if (used.has(entryName)) entryName = `${i}_${entryName}`;
      used.add(entryName);
      archive.append(buf, { name: entryName });
    } catch {
      // 개별 이미지 실패는 건너뛰고 나머지를 계속 압축
    }
  }

  archive.finalize();
}

// ---- 라우터 ---------------------------------------------------------------

const server = http.createServer(async (req, res) => {
  try {
    const parsed = new URL(req.url, `http://${req.headers.host}`);
    const { pathname } = parsed;

    if (req.method === "GET" && pathname === "/api/status") {
      return sendJson(res, 200, { loggedIn: isLoggedIn() });
    }
    if (req.method === "POST" && pathname === "/api/extract") {
      return await handleExtract(req, res);
    }
    if (req.method === "GET" && pathname === "/download") {
      return await handleDownload(req, res, parsed.searchParams);
    }
    if (req.method === "POST" && pathname === "/download-zip") {
      return await handleDownloadZip(req, res);
    }
    if (req.method === "GET") {
      return serveStatic(req, res, pathname);
    }

    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  } catch (err) {
    console.error(err);
    if (!res.headersSent) {
      sendJson(res, 500, { error: "서버 오류가 발생했어요." });
    } else {
      res.end();
    }
  }
});

server.listen(PORT, HOST, () => {
  console.log(`marae-emoticon listening on http://${HOST}:${PORT}`);
});
