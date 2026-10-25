(function () {
  "use strict";
  const Q = window.QUIZ;
  const CHAKRA_QUESTIONS = 7;

  // ---------- 計分（與機率驗證程式的規則相同） ----------
  // answers：每題選到的「原始選項編號」（data.js 裡的順序，從 0 開始）
  function computeResult(answers) {
    // 1. 脈輪：加權總分最高者；同分時取最後選到的
    const cScore = {}, cLast = {};
    for (let q = 0; q < CHAKRA_QUESTIONS; q++) {
      const c = Q.questions[q].options[answers[q]].chakra;
      cScore[c] = (cScore[c] || 0) + Q.chakraWeights[c];
      cLast[c] = q;
    }
    const chakra = Object.keys(cScore).sort((a, b) => cScore[b] - cScore[a] || cLast[b] - cLast[a])[0];

    // 2. 需求排序：得分高者優先；同分時最後選到的優先
    const nScore = {}, nLast = {};
    for (let q = CHAKRA_QUESTIONS; q < Q.questions.length; q++) {
      const n = Q.questions[q].options[answers[q]].need;
      nScore[n] = (nScore[n] || 0) + 1;
      nLast[n] = q;
    }
    const needRank = Object.keys(nScore).sort((a, b) => nScore[b] - nScore[a] || nLast[b] - nLast[a]);

    // 3. 在該脈輪中找第一個有對應卡片的需求
    const inChakra = Q.cards.filter(c => c.chakra === chakra);
    for (const n of needRank) {
      const card = inChakra.find(c => c.need === n);
      if (card) return { card, chakra, topNeed: needRank[0] };
    }
    // 4. 都找不到：用所有選項編號加總取餘數，讓同脈輪的卡機率相同
    const avail = Q.needOrder.filter(n => inChakra.some(c => c.need === n));
    const sum = answers.reduce((s, a) => s + a, 0);
    const card = inChakra.find(c => c.need === avail[sum % avail.length]);
    return { card, chakra, topNeed: needRank[0] };
  }

  // 讓驗證腳本（Node）可以直接呼叫計分函式
  if (typeof module !== "undefined") { module.exports = { computeResult }; }
  if (typeof document === "undefined") return;

  // ---------- 工具 ----------
  const $ = id => document.getElementById(id);
  const screens = ["home", "quiz", "reveal", "result", "gallery"];
  function show(name) {
    screens.forEach(s => { $("screen-" + s).hidden = s !== name; });
    window.scrollTo(0, 0);
  }
  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  let toastTimer;
  function toast(msg) {
    const t = $("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 2400);
  }
  const imgSrc = card => `cards/${card.id}.webp`;
  const cardById = id => Q.cards.find(c => c.id === id);
  function setUrl(cardId) {
    const url = new URL(location.href);
    if (cardId) url.searchParams.set("card", cardId); else url.searchParams.delete("card");
    history.replaceState(null, "", url);
  }
  function shareUrl(card) {
    const url = new URL(location.href);
    url.search = "?card=" + card.id;
    url.hash = "";
    return url.toString();
  }

  // ---------- 首頁 ----------
  $("screen-home").querySelector(".home-title").textContent = Q.title;
  $("screen-home").querySelector(".home-sub").textContent = Q.subtitle;

  // ---------- 答題 ----------
  let answers = [], order = [], current = 0, locked = false;

  function startQuiz() {
    answers = new Array(Q.questions.length);
    order = Q.questions.map(q => shuffle(q.options.map((_, i) => i)));
    current = 0;
    setUrl(null);
    renderQuestion();
    show("quiz");
  }

  function renderQuestion() {
    const q = Q.questions[current];
    const total = Q.questions.length;
    $("progress-text").textContent = `${current + 1} / ${total}`;
    $("progress-bar").style.width = `${(current / total) * 100}%`;
    $("part-label").textContent = current < CHAKRA_QUESTIONS ? "第一部分・你的能量狀態" : "第二部分・你此刻的需要";
    $("question-text").textContent = q.text;
    $("btn-back").disabled = current === 0;
    const box = $("options");
    box.innerHTML = "";
    order[current].forEach(i => {
      const b = document.createElement("button");
      b.className = "option" + (answers[current] === i ? " selected" : "");
      b.textContent = q.options[i].text;
      b.addEventListener("click", () => choose(i, b));
      box.appendChild(b);
    });
    locked = false;
  }

  function choose(i, el) {
    if (locked) return;
    locked = true;
    answers[current] = i;
    $("options").querySelectorAll(".option").forEach(o => o.classList.remove("selected"));
    el.classList.add("selected");
    setTimeout(() => {
      if (current < Q.questions.length - 1) {
        current++;
        renderQuestion();
      } else {
        $("progress-bar").style.width = "100%";
        reveal(computeResult(answers));
      }
    }, 280);
  }

  $("btn-back").addEventListener("click", () => {
    if (current > 0 && !locked) { current--; renderQuestion(); }
  });

  // ---------- 翻卡 ----------
  let lastResult = null;
  function reveal(result) {
    lastResult = result;
    const flip = $("flip-card");
    flip.classList.remove("flipped");
    flip.disabled = false;
    $("reveal-hint").style.opacity = 1;
    $("reveal-img").src = imgSrc(result.card);
    $("reveal-img").alt = result.card.name;
    show("reveal");
  }
  $("flip-card").addEventListener("click", () => {
    const flip = $("flip-card");
    if (flip.classList.contains("flipped")) return;
    flip.classList.add("flipped");
    flip.disabled = true;
    $("reveal-hint").style.opacity = 0;
    setTimeout(() => showCard(lastResult.card, "result", lastResult), 1500);
  });

  // ---------- 結果／卡片介紹 ----------
  // mode: "result" 自己測出來的、"shared" 朋友分享的連結、"gallery" 從圖鑑點進來的
  let shownCard = null;
  function showCard(card, mode, result) {
    shownCard = card;
    const ch = Q.chakras[card.chakra];
    $("result-intro").textContent = mode === "result" ? "此刻陪伴你的是" : mode === "shared" ? "朋友抽到了這張卡" : "";
    $("result-img").src = imgSrc(card);
    $("result-img").alt = card.name;
    $("chakra-badge").innerHTML = "";
    const dot = document.createElement("i");
    dot.style.background = ch.color;
    $("chakra-badge").append(dot, `${ch.name} ${ch.en}・${ch.theme}`);
    $("card-name").textContent = card.name;
    $("card-latin").innerHTML = "";
    const em = document.createElement("em");
    em.textContent = card.latin;
    $("card-latin").append(card.en + "・", em);
    $("card-message").textContent = card.message;
    $("card-message-en").textContent = card.messageEn;
    $("card-usage").textContent = card.usage;

    $("panel-why").hidden = mode !== "result";
    if (mode === "result") {
      $("why-chakra").textContent = ch.desc;
      $("why-need").textContent = Q.needs[result.topNeed].desc;
    }
    $("actions-result").hidden = mode !== "result";
    $("actions-shared").hidden = mode !== "shared";
    $("actions-gallery").hidden = mode !== "gallery";
    setUrl(mode === "gallery" ? null : card.id);
    show("result");
  }

  // ---------- 分享 ----------
  $("btn-share").addEventListener("click", async () => {
    const card = shownCard;
    const url = shareUrl(card);
    const text = `我在「${Q.title}」抽到了「${card.name}」：${card.message}`;
    if (navigator.share) {
      try { await navigator.share({ title: Q.title, text, url }); } catch (e) { /* 使用者取消 */ }
      return;
    }
    try {
      await navigator.clipboard.writeText(`${text}\n${url}`);
      toast("已複製連結，貼給朋友吧！");
    } catch (e) {
      prompt("複製這個連結分享給朋友：", url);
    }
  });

  // ---------- 儲存結果圖（1080×1920，適合限動） ----------
  function wrapText(ctx, text, maxWidth, byWord) {
    const units = byWord ? text.split(/(?<= )/) : Array.from(text);
    const lines = [];
    let line = "";
    for (const u of units) {
      if (ctx.measureText(line + u).width > maxWidth && line) { lines.push(line.trimEnd()); line = u; }
      else line += u;
    }
    if (line) lines.push(line.trimEnd());
    return lines;
  }
  // 讓每行長度接近，避免最後一行只剩一兩個字
  function wrapBalanced(ctx, text, maxWidth, byWord) {
    const n = wrapText(ctx, text, maxWidth, byWord).length;
    if (n < 2) return [text];
    let w = ctx.measureText(text).width / n;
    let lines;
    do { lines = wrapText(ctx, text, w, byWord); w += 8; } while (lines.length > n && w < maxWidth);
    return lines;
  }
  function loadImage(src) {
    return new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = rej;
      img.src = src;
    });
  }
  async function makeResultImage(card) {
    const W = 1080, H = 1920;
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const ctx = c.getContext("2d");
    const serif = '"Noto Serif TC", serif';
    try {
      await Promise.all([
        document.fonts.load(`700 64px ${serif}`, card.name),
        document.fonts.load(`400 40px ${serif}`, card.message),
        document.fonts.load(`italic 400 34px "Cormorant Garamond"`)
      ]);
    } catch (e) { /* 字型載入失敗就用系統字 */ }

    ctx.fillStyle = "#f6f0e6";
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = "#d9c3a0";
    ctx.lineWidth = 2;
    ctx.strokeRect(40, 40, W - 80, H - 80);

    ctx.textAlign = "center";
    ctx.fillStyle = "#b48a4e";
    ctx.font = `400 34px ${serif}`;
    ctx.fillText(`${Q.title}・此刻陪伴我的是`, W / 2, 150);

    const img = await loadImage(imgSrc(card));
    const iw = 560, ih = Math.round(iw * img.height / img.width);
    const ix = (W - iw) / 2, iy = 200;
    ctx.save();
    ctx.shadowColor = "rgba(74,59,48,.3)";
    ctx.shadowBlur = 30;
    ctx.shadowOffsetY = 12;
    ctx.drawImage(img, ix, iy, iw, ih);
    ctx.restore();

    let y = iy + ih + 110;
    ctx.fillStyle = "#4a3b30";
    ctx.font = `700 72px ${serif}`;
    ctx.fillText(card.name, W / 2, y);

    const ch = Q.chakras[card.chakra];
    y += 64;
    ctx.font = `400 32px ${serif}`;
    ctx.fillStyle = ch.color;
    ctx.fillText(`● ${ch.name}・${ch.theme}`, W / 2, y);

    y += 80;
    ctx.fillStyle = "#4a3b30";
    ctx.font = `400 40px ${serif}`;
    for (const line of wrapBalanced(ctx, card.message, W - 220)) { ctx.fillText(line, W / 2, y); y += 64; }

    y += 24;
    ctx.fillStyle = "#7d6b5c";
    ctx.font = `italic 400 34px "Cormorant Garamond", Georgia, serif`;
    for (const line of wrapBalanced(ctx, card.messageEn, W - 240, true)) { ctx.fillText(line, W / 2, y); y += 46; }

    ctx.fillStyle = "#7d6b5c";
    ctx.font = `400 28px ${serif}`;
    ctx.fillText("憑直覺回答 10 題，找到你的那張卡", W / 2, H - 100);

    return new Promise((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error("toBlob failed"))), "image/png"));
  }

  $("btn-save").addEventListener("click", async () => {
    const card = shownCard;
    toast("正在產生圖片…");
    let blob;
    try {
      blob = await makeResultImage(card);
    } catch (e) {
      // 直接用 file:// 開啟時瀏覽器會擋住畫布輸出，上線後就正常
      toast("目前無法產生圖片，網站上線後就能使用");
      return;
    }
    const file = new File([blob], `${card.id}_${card.name}.png`, { type: "image/png" });
    const isTouch = matchMedia("(pointer: coarse)").matches;
    if (isTouch && navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file] }); return; } catch (e) { /* 取消就改用下載 */ }
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast("圖片已儲存");
  });

  // ---------- 圖鑑 ----------
  function buildGallery() {
    const root = $("gallery");
    if (root.childElementCount) return;
    Object.entries(Q.chakras).forEach(([key, ch]) => {
      const cards = Q.cards.filter(c => c.chakra === key);
      const group = document.createElement("div");
      group.className = "gallery-group";
      const h = document.createElement("h3");
      const dot = document.createElement("i");
      dot.style.background = ch.color;
      const small = document.createElement("small");
      small.textContent = `${ch.theme}・${cards.length} 張`;
      h.append(dot, ch.name + " ", small);
      const grid = document.createElement("div");
      grid.className = "gallery-grid";
      cards.forEach(card => {
        const b = document.createElement("button");
        b.className = "gallery-item";
        const img = document.createElement("img");
        img.src = imgSrc(card);
        img.alt = card.name;
        img.loading = "lazy";
        const name = document.createElement("span");
        name.textContent = card.name;
        b.append(img, name);
        b.addEventListener("click", () => showCard(card, "gallery"));
        grid.appendChild(b);
      });
      group.append(h, grid);
      root.appendChild(group);
    });
  }
  function openGallery() { buildGallery(); setUrl(null); show("gallery"); }
  function goHome() { setUrl(null); show("home"); }

  // ---------- 按鈕 ----------
  $("btn-start").addEventListener("click", startQuiz);
  $("btn-retry").addEventListener("click", startQuiz);
  $("btn-try").addEventListener("click", startQuiz);
  ["btn-gallery-home", "btn-gallery", "btn-gallery-shared", "btn-back-gallery"].forEach(id => $(id).addEventListener("click", openGallery));
  $("btn-gallery-close").addEventListener("click", goHome);
  $("btn-home-from-card").addEventListener("click", goHome);

  // ---------- 進站：有 ?card= 就直接顯示朋友分享的卡 ----------
  const shared = cardById(new URLSearchParams(location.search).get("card"));
  if (shared) showCard(shared, "shared"); else show("home");
})();
