console.log("🔥 brand-plan-view.js 로딩됨");

/* ======================================================
   URL 파라미터
====================================================== */
const params = new URLSearchParams(location.search);
const USER_ID = params.get("user");

if (!USER_ID) {
  document.getElementById("loading").textContent = "유효하지 않은 접근입니다.";
}

/* ======================================================
   안전 JSON 파서
====================================================== */
function safeParse(value) {
  if (!value) return [];

  if (Array.isArray(value)) return value;

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {}

  if (typeof value === "string") {
    return value
      .replace(/\[|\]/g, "")
      .split(",")
      .map((v) => v.trim())
      .filter((v) => v.length > 0);
  }

  return [];
}

/* ======================================================
   태그 출력
====================================================== */
function fillTags(elementId, list) {
  const area = document.getElementById(elementId);
  if (!area) return;

  area.innerHTML = "";

  if (!Array.isArray(list) || list.length === 0) {
    area.innerHTML = "<div style='color:#999;'>없음</div>";
    return;
  }

  list.forEach((tag) => {
    const div = document.createElement("div");
    div.className = "tag";
    div.textContent = tag;
    area.appendChild(div);
  });
}

/* ======================================================
   브랜드 설계 데이터 로드
====================================================== */
async function loadBrandPlan() {
  try {
    const res = await fetch(`${API}/brand-plan/view?user=${USER_ID}`);
    const data = await res.json();

    console.log("📦 brand-plan/view 결과:", data);

    if (!data.success) {
      document.getElementById("loading").textContent =
        "브랜드 설계 데이터가 존재하지 않습니다.";
      return;
    }

    const plan = data.plan;

    document.getElementById("loading").style.display = "none";
    document.getElementById("content").style.display = "block";

    const keywords = safeParse(plan.keywords);
    const toneTags = safeParse(plan.tone_tags);
    const spreadTags = safeParse(plan.spread_tags);

    fillTags("keywords", keywords);
    fillTags("toneTags", toneTags);
    fillTags("spreadTags", spreadTags);

    document.getElementById("story").textContent = plan.story || "";
    document.getElementById("concept").textContent = plan.concept || "";
    document.getElementById("targetCustomer").textContent =
      plan.target_customer || "";
    document.getElementById("expandPlan").textContent =
      plan.expand_plan || "";

  } catch (err) {
    console.error("❌ 브랜드 설계 로드 오류:", err);
    document.getElementById("loading").textContent =
      "서버 오류 발생. 다시 시도해주세요.";
  }
}

/* ======================================================
   히스토리 모달 열기
====================================================== */
function openModal(item) {
  const modal = document.getElementById("resultModal");
  const content = document.getElementById("modalContent");

  let html = "";

  if (item.output_type === "image" && item.output_file) {
    html = `<img src="${item.output_file}" style="max-width:100%; border-radius:10px;">`;
  }
  else if (item.output_type === "video" && item.output_file) {
    html = `
      <video controls style="width:100%; border-radius:10px;">
        <source src="${item.output_file}" type="video/mp4">
      </video>`;
  }
  else if (item.output_type === "url" && item.output_url) {
    html = `
      <a href="${item.output_url}" target="_blank" 
         style="color:#0056ff; font-size:16px;">
         ▶ 결과물 보러가기
      </a>
    `;
  }
  else {
    html = `<div style="color:#666;">등록된 결과물이 없습니다.</div>`;
  }

  content.innerHTML = html;
  modal.style.display = "flex";
}

/* ======================================================
   모달 닫기
====================================================== */
document.getElementById("modalClose").onclick = () => {
  document.getElementById("resultModal").style.display = "none";
};

document.getElementById("resultModal").onclick = (e) => {
  if (e.target.id === "resultModal") {
    document.getElementById("resultModal").style.display = "none";
  }
};

/* ======================================================
   🔥 작업 히스토리 로드
====================================================== */
async function loadHistory() {
  const res = await fetch(`${API}/brand-plan/history?user=${USER_ID}`)

  const data = await res.json();

  const area = document.getElementById("historyList");
  area.innerHTML = "";

  if (!data.success || data.history.length === 0) {
    area.innerHTML = "<div style='color:#aaa;'>아직 기록된 작업이 없습니다.</div>";
    return;
  }

  // 🔵 1) 전문가별 그룹핑
  const groups = {};
  data.history.forEach(item => {
    if (!groups[item.expert_nickname]) {
      groups[item.expert_nickname] = [];
    }
    groups[item.expert_nickname].push(item);
  });

  // 🔵 2) 전문가 섹션 생성
  Object.keys(groups).forEach(expert => {
    const section = document.createElement("div");
    section.className = "expert-section";

    section.innerHTML = `
      <div class="expert-header">
        <span class="expert-name">👤 ${expert}</span>
        <span class="arrow">▼</span>
      </div>
      <div class="expert-body" style="display:none;"></div>
    `;

    area.appendChild(section);

    const body = section.querySelector(".expert-body");

    // 🔵 3) 전문가별 작업 카드 추가
    groups[expert].forEach(item => {
      const div = document.createElement("div");
      div.className = "history-item";

      div.innerHTML = `
        <div class="step">📘 ${item.plan_step}</div>
        <div class="desc">${item.description}</div>
        <button class="result-btn">결과물 보기</button>
      `;

      // 결과물 보기 기능 연결
      div.querySelector(".result-btn").onclick = () => openModal(item);

      body.appendChild(div);
    });

    // 🔵 4) 아코디언 열닫기
    section.querySelector(".expert-header").onclick = () => {
      const visible = body.style.display === "block";
      body.style.display = visible ? "none" : "block";
      section.querySelector(".arrow").textContent = visible ? "▼" : "▲";
    };
  });
}


/* ======================================================
   뒤로가기
====================================================== */
document.getElementById("backBtn").onclick = () => {
  history.back();
};

/* ======================================================
   초기 실행
====================================================== */
loadBrandPlan();
loadHistory();
