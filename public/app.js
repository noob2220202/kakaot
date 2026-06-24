(() => {
  const form = document.getElementById("extract-form");
  const input = document.getElementById("input-url");
  const extractBtn = document.getElementById("extract-btn");
  const statusPill = document.getElementById("status-pill");

  const emptyState = document.getElementById("empty-state");
  const loadingState = document.getElementById("loading-state");
  const errorState = document.getElementById("error-state");
  const errorMessage = document.getElementById("error-message");
  const groups = document.getElementById("groups");
  const resultTitle = document.getElementById("result-title");

  const gridAnimated = document.getElementById("grid-animated");
  const gridStills = document.getElementById("grid-stills");
  const countAnimated = document.getElementById("count-animated");
  const countStills = document.getElementById("count-stills");
  const zipAnimatedBtn = document.getElementById("zip-animated");
  const zipStillsBtn = document.getElementById("zip-stills");
  const noticeAnimated = document.getElementById("notice-animated");
  const noticeStills = document.getElementById("notice-stills");

  let currentAnimated = [];
  let currentStills = [];
  let currentTitle = "emoticon";

  function sanitizeFilename(name) {
    return String(name).replace(/[\\/:*?"<>|]+/g, "_").trim().slice(0, 80) || "emoticon";
  }

  function showState(state) {
    emptyState.hidden = state !== "empty";
    loadingState.hidden = state !== "loading";
    errorState.hidden = state !== "error";
    groups.hidden = state !== "result";
  }

  function setStatusPill(loggedIn) {
    statusPill.classList.remove("pill--in", "pill--out", "pill--unknown");
    statusPill.classList.add(loggedIn ? "pill--in" : "pill--out");
    statusPill.querySelector(".pill-text").textContent = loggedIn ? "로그인됨" : "정지 이미지만";
  }

  async function refreshStatus() {
    try {
      const resp = await fetch("/api/status");
      const data = await resp.json();
      setStatusPill(Boolean(data.loggedIn));
    } catch {
      setStatusPill(false);
    }
  }

  function showToast(message) {
    const root = document.getElementById("toast-root");
    const el = document.createElement("div");
    el.className = "toast";
    el.textContent = message;
    root.appendChild(el);
    setTimeout(() => el.remove(), 2500);
  }

  function guessFilename(url) {
    try {
      const u = new URL(url);
      const base = u.pathname.split("/").pop();
      return base && base.includes(".") ? base : "emoticon.png";
    } catch {
      return "emoticon.png";
    }
  }

  function triggerBlobDownload(blob, filename) {
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 4000);
  }

  async function downloadSingle(url) {
    try {
      const resp = await fetch(`/download?url=${encodeURIComponent(url)}`);
      if (!resp.ok) throw new Error("download failed");
      const blob = await resp.blob();
      triggerBlobDownload(blob, guessFilename(url));
      showToast("저장됐어요");
    } catch {
      showToast("다운로드에 실패했어요");
    }
  }

  async function downloadZip(urls, namePart) {
    if (urls.length === 0) return;
    try {
      const resp = await fetch("/download-zip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urls, name: namePart }),
      });
      if (!resp.ok) throw new Error("zip failed");
      const blob = await resp.blob();
      triggerBlobDownload(blob, `${namePart}.zip`);
      showToast("저장됐어요");
    } catch {
      showToast("ZIP 다운로드에 실패했어요");
    }
  }

  function renderGroup({ grid, urls, zipBtn, notice, noticeText }) {
    grid.innerHTML = "";

    if (urls.length === 0) {
      zipBtn.disabled = true;
      notice.textContent = noticeText || "";
      notice.hidden = !noticeText;
      return;
    }

    notice.hidden = true;
    zipBtn.disabled = false;

    urls.forEach((url, i) => {
      const card = document.createElement("div");
      card.className = "card";

      const img = document.createElement("img");
      img.src = url;
      img.loading = "lazy";
      img.alt = `이모티콘 ${i + 1}`;
      card.appendChild(img);

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "card-dl";
      btn.textContent = "저장";
      btn.addEventListener("click", () => downloadSingle(url));
      card.appendChild(btn);

      grid.appendChild(card);
    });
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const value = input.value.trim();
    if (!value) return;

    extractBtn.disabled = true;
    showState("loading");

    try {
      const resp = await fetch("/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: value }),
      });
      const data = await resp.json();

      if (!resp.ok) {
        errorMessage.textContent = data.error || "알 수 없는 오류가 발생했어요.";
        showState("error");
        return;
      }

      currentAnimated = data.animated || [];
      currentStills = data.stills || [];
      currentTitle = data.title || "emoticon";

      resultTitle.textContent = currentTitle;
      countAnimated.textContent = `${currentAnimated.length}개`;
      countStills.textContent = `${currentStills.length}개`;

      renderGroup({
        grid: gridAnimated,
        urls: currentAnimated,
        zipBtn: zipAnimatedBtn,
        notice: noticeAnimated,
        noticeText: data.loggedIn
          ? "이 이모티콘에는 움직이는 버전이 없어요."
          : "움직이는 이모티콘은 로그인이 필요해요 (터미널에서 node login.js).",
      });

      renderGroup({
        grid: gridStills,
        urls: currentStills,
        zipBtn: zipStillsBtn,
        notice: noticeStills,
        noticeText: "정지 이미지가 없어요.",
      });

      setStatusPill(Boolean(data.loggedIn));
      showState("result");
    } catch {
      errorMessage.textContent = "서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.";
      showState("error");
    } finally {
      extractBtn.disabled = false;
    }
  });

  zipAnimatedBtn.addEventListener("click", () =>
    downloadZip(currentAnimated, `${sanitizeFilename(currentTitle)}_anim`)
  );
  zipStillsBtn.addEventListener("click", () =>
    downloadZip(currentStills, `${sanitizeFilename(currentTitle)}_still`)
  );

  refreshStatus();
})();
