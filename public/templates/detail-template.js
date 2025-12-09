/* ==========================================================
   DETAIL TEMPLATE SCRIPT
   (service-detail.html 기능을 100% 유지한 별도 모듈 버전)
========================================================== */

const DETAIL_API = "http://localhost:3000";

/* -----------------------------------------------
   안전 JSON 파싱
----------------------------------------------- */
function detailSafeParse(val) {
  if (!val) return null;
  if (typeof val === "object") return val;
  try { return JSON.parse(val); }
  catch { return null; }
}

/* ===================================================================
   📌 메인 엔트리 — 외부에서 호출하는 함수
   loadServiceDetail(serviceId, containerElement)
   → 상세페이지를 container 내부에 동적으로 생성함
=================================================================== */
async function loadServiceDetail(serviceId, container) {
  if (!serviceId || !container) return;

  // 템플릿 HTML을 container에 삽입
  container.innerHTML = DETAIL_TEMPLATE_HTML;

  // 로딩 후 DOM 오브젝트 생성
  const root = container.querySelector(".detail-root");

  await detailLoadServiceData(serviceId, root);
}

/* ===================================================================
   1) 서비스 데이터 로드
=================================================================== */
async function detailLoadServiceData(serviceId, root) {
  try {
    const res = await fetch(`${DETAIL_API}/services/${serviceId}`);
    const data = await res.json();

    if (!data.success) {
      root.innerHTML = `<p style="padding:20px;color:#999;">서비스 정보를 불러올 수 없습니다.</p>`;
      return;
    }

    const svc = data.service;
    const expert = data.expert || {};

    detailRenderHero(svc, root);
    detailRenderImages(svc, root);
    detailRenderDescription(svc, root);
    detailRenderExpert(expert, root);
    detailRenderQA(svc.customer_request, root);

    if (svc.is_package_mode == 1) {
      detailRenderPackagePrice(svc, root);
    } else {
      detailRenderSinglePrice(svc, root);
    }

    detailInitTabs(root);

  } catch (err) {
    console.error(err);
    root.innerHTML = `<p style="padding:20px;color:red;">서버 오류 발생</p>`;
  }
}

/* ===================================================================
   2) HERO 영역 렌더링
=================================================================== */
function detailRenderHero(svc, root) {
  root.querySelector(".hero-title").textContent = svc.title;
  root.querySelector(".hero-meta").innerHTML = `
    <span>${svc.main_category}</span> · <span>${svc.sub_category}</span>
  `;

  const wrap = root.querySelector(".keyword-wrap");
  wrap.innerHTML = "";

  (svc.keywords || "")
    .split(",")
    .filter(v => v.trim() !== "")
    .forEach(k => {
      const chip = document.createElement("span");
      chip.className = "keyword-chip";
      chip.textContent = "#" + k.trim();
      wrap.appendChild(chip);
    });
}

/* ===================================================================
   3) 이미지 영역
=================================================================== */
function detailRenderImages(svc, root) {
  const mainImgs = detailSafeParse(svc.main_images) || [];
  const mainEl = root.querySelector("#mainSlideImg");
  mainEl.src = mainImgs[0] || "/assets/default_service.png";

  const thumbWrap = root.querySelector("#thumbRow");
  thumbWrap.innerHTML = "";

  mainImgs.forEach((img, index) => {
    const t = document.createElement("img");
    t.src = img;
    if (index === 0) t.classList.add("active");

    t.onclick = () => {
      mainEl.src = img;
      thumbWrap.querySelectorAll("img").forEach(el => el.classList.remove("active"));
      t.classList.add("active");
    };

    thumbWrap.appendChild(t);
  });
}

/* ===================================================================
   4) 설명 섹션
=================================================================== */
function detailRenderDescription(svc, root) {
  root.querySelector("#descText").innerHTML =
    (svc.description || "").replace(/\n/g, "<br>");

  root.querySelector("#brandText").innerHTML =
    (svc.brand_concept || "").replace(/\n/g, "<br>");

  root.querySelector("#processText").innerHTML =
    (svc.process || "").replace(/\n/g, "<br>");

  // 상세 이미지
  const box = root.querySelector("#detailImagesBox");
  box.innerHTML = "";
  (detailSafeParse(svc.detail_images) || []).forEach(img => {
    const el = document.createElement("img");
    el.src = img;
    el.className = "detail-image";
    box.appendChild(el);
  });
}

/* ===================================================================
   5) 전문가 정보
=================================================================== */
function detailRenderExpert(ex, root) {
  const avatar = root.querySelector("#expertAvatar");
  const nameEl = root.querySelector("#expertName");
  const intro = root.querySelector("#expertIntroFull");
  const toggle = root.querySelector("#expertToggleBtn");

  avatar.src = ex.avatar_url || "/assets/default_profile.png";
  nameEl.textContent = ex.nickname || "전문가";
  intro.textContent = ex.intro || "등록된 소개 글이 없습니다.";

  let opened = false;
  toggle.onclick = () => {
    opened = !opened;
    intro.style.maxHeight = opened ? "2000px" : "100px";
    toggle.textContent = opened ? "접기" : "더보기";
  };
}

/* ===================================================================
   6) 단일 가격 렌더링
=================================================================== */
function detailRenderSinglePrice(svc, root) {
  const rightTitle = root.querySelector("#sideTitle");
  const rightPrice = root.querySelector("#sidePrice");
  const rightDur = root.querySelector("#sideDuration");
  const rightOffer = root.querySelector("#sideOffer");

  const bottomPrice = root.querySelector("#bottomPriceAmount");
  const bottomDur = root.querySelector("#bottomDuration");
  const bottomRev = root.querySelector("#bottomRevision");
  const bottomOffer = root.querySelector("#bottomOffer");

  const offerItems = (svc.offer_items || "")
    .split("\n")
    .filter(v => v.trim() !== "")
    .map(v => `<li>${v}</li>`).join("");

  const price = Number(svc.price_basic || 0).toLocaleString() + "원";

  rightTitle.textContent = svc.title;
  rightPrice.textContent = price;
  rightDur.textContent = `작업 기간: ${svc.duration} · 수정 횟수: ${svc.revision_count}`;
  rightOffer.innerHTML = `<ul>${offerItems}</ul>`;

  bottomPrice.textContent = price;
  bottomDur.textContent = svc.duration;
  bottomRev.textContent = svc.revision_count;
  bottomOffer.innerHTML = `<ul>${offerItems}</ul>`;
}

/* ===================================================================
   7) 패키지 가격 렌더링
=================================================================== */
function detailRenderPackagePrice(svc, root) {
  const pkg = detailSafeParse(svc.package_json);
  if (!pkg) return detailRenderSinglePrice(svc, root);

  const orders = ["BASIC", "STANDARD", "PREMIUM"].filter(k => pkg[k]);
  let current = orders[0];

  const topTabs = root.querySelector("#pkgTabs");
  const rightTabs = root.querySelector("#sideTabs");
  const bottomTabs = root.querySelector("#priceBottomTabs");

  const rightTitle = root.querySelector("#sideTitle");
  const rightPrice = root.querySelector("#sidePrice");
  const rightDur = root.querySelector("#sideDuration");
  const rightOffer = root.querySelector("#sideOffer");

  const bottomPrice = root.querySelector("#bottomPriceAmount");
  const bottomDur = root.querySelector("#bottomDuration");
  const bottomRev = root.querySelector("#bottomRevision");
  const bottomOffer = root.querySelector("#bottomOffer");

  function buildTabs(area, cls) {
    if (!area) return;
    area.innerHTML = "";

    orders.forEach(k => {
      const btn = document.createElement("button");
      btn.className = cls;
      btn.dataset.key = k;
      btn.textContent = k;

      if (k === current) btn.classList.add("active");

      btn.onclick = () => {
        current = k;
        updateAllTabs();
        updateUI();
      };

      area.appendChild(btn);
    });
  }

  function updateAllTabs() {
    root.querySelectorAll(".pkg-tab, .side-tab").forEach(el => {
      if (el.dataset.key === current) el.classList.add("active");
      else el.classList.remove("active");
    });
  }

  function updateUI() {
    const item = pkg[current];
    const itemPrice = Number(item.price || 0).toLocaleString() + "원";

    const offerItems = (svc.offer_items || "")
      .split("\n")
      .filter(v => v.trim() !== "")
      .map(v => `<li>${v}</li>`).join("");

    /* RIGHT */
    rightTitle.textContent = item.title || current;
    rightPrice.textContent = itemPrice;
    rightDur.textContent = `작업 기간: ${item.duration} · 수정 횟수: ${item.revision}`;
    rightOffer.innerHTML = `<ul>${offerItems}</ul>`;

    /* BOTTOM */
    bottomPrice.textContent = itemPrice;
    bottomDur.textContent = item.duration;
    bottomRev.textContent = item.revision;
    bottomOffer.innerHTML = `<ul>${offerItems}</ul>`;
  }

  buildTabs(topTabs, "pkg-tab");
  buildTabs(rightTabs, "side-tab");
  buildTabs(bottomTabs, "pkg-tab");

  updateUI();
}

/* ===================================================================
   8) Q&A
=================================================================== */
function detailRenderQA(raw, root) {
  const box = root.querySelector("#qaList");
  const arr = detailSafeParse(raw);

  if (!arr || arr.length === 0) {
    box.innerHTML = `<div class="empty-text">등록된 요청사항/프로젝트 정보가 없습니다.</div>`;
    return;
  }

  box.innerHTML = "";

  arr.forEach(v => {
    const card = document.createElement("div");
    card.className = "qa-card";
    card.innerHTML = `
      <div class="qa-q">Q. ${v.question}</div>
      <div class="qa-a">${(v.answer || "").replace(/\n/g, "<br>")}</div>
    `;
    box.appendChild(card);
  });
}

/* ===================================================================
   9) NAV TABS
=================================================================== */
function detailInitTabs(root) {
  root.querySelectorAll(".tab-nav").forEach(tab => {
    tab.onclick = () => {
      root.querySelectorAll(".tab-nav").forEach(t => t.classList.remove("active"));
      tab.classList.add("active");

      const target = root.querySelector(`#${tab.dataset.target}`);
      const offset = target.getBoundingClientRect().top + window.scrollY - 90;

      window.scrollTo({
        top: offset,
        behavior: "smooth"
      });
    };
  });
}

/* ===================================================================
   템플릿 HTML — 그대로 삽입됨
=================================================================== */
const DETAIL_TEMPLATE_HTML = `
<div class="detail-root">
  ${document.querySelector("#detail-template-html")?.innerHTML || ""}
</div>
`;
