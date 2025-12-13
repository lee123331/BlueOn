/* ======================================================
   기본 설정
====================================================== */
const API = "https://blueon.up.railway.app";
const serviceId = new URLSearchParams(location.search).get("id");
let slideImgs = [];

/* ======================================================
   토스트 알림
====================================================== */
function showToast(msg) {
  const t = document.getElementById("toast");
  if (!t) return;
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2000);
}

/* ======================================================
   공통 유틸
====================================================== */
function safeParse(v) {
  if (v == null) return null;
  if (typeof v === "object") return v;
  try { return JSON.parse(v); } catch { return null; }
}

/* ======================================================
   구매 버튼 (🔥 최종 안정화)
====================================================== */
function initBuyButtons() {
  const buttons = document.querySelectorAll(".btn-buy, .price-buy-btn");

  buttons.forEach(btn => {
    btn.onclick = async () => {

      if (!serviceId) {
        showToast("잘못된 접근입니다.");
        return;
      }

      try {
        const res = await fetch(`${API}/orders/create`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ serviceId })
        });

        // ❌ 서버 통신 자체 실패
        if (!res.ok) {
          showToast("서버 통신 오류가 발생했습니다.");
          return;
        }

        const data = await res.json();

        /* ======================================================
           ✅ 핵심 규칙
           - orderId가 있으면 무조건 주문 성공
           - success / 알림 실패 여부는 UX에 노출 ❌
        ====================================================== */

        if (data.orderId) {
          // 중복 입금 대기 주문 안내는 UX만 제공
          if (data.code === "DUPLICATE_PENDING") {
            showToast("이미 입금 대기 중인 주문이 있습니다.");
          }

          // 🔥 무조건 주문 페이지로 이동
          location.href = `/order-pay.html?orderId=${data.orderId}`;
          return;
        }

        // ❌ 진짜 실패 (orderId 없음)
        console.warn("주문 생성 실패 응답:", data);
        showToast(data.message || "주문 생성에 실패했습니다.");

      } catch (err) {
        console.error("❌ 주문 생성 오류:", err);
        showToast("예상치 못한 오류가 발생했습니다.");
      }
    };
  });
}

/* ======================================================
   전문가 정보
====================================================== */
function initExpertBox(ex) {
  document.getElementById("expertAvatar").src =
    ex.avatar_url || "/assets/default_profile.png";
  document.getElementById("expertName").textContent =
    ex.nickname || "전문가";
  document.getElementById("expertIntroFull").textContent =
    ex.intro || "등록된 소개 글이 없습니다.";
}

/* ======================================================
   가격 렌더링 (단일)
====================================================== */
function renderSinglePrice(service) {
  document.getElementById("sideTitle").textContent = service.title;
  document.getElementById("sidePrice").textContent =
    Number(service.price_basic).toLocaleString() + "원";
  document.getElementById("sideDuration").textContent =
    `작업 기간: ${service.duration} · 수정 ${service.revision_count}회`;

  document.getElementById("bottomPriceAmount").textContent =
    Number(service.price_basic).toLocaleString() + "원";
  document.getElementById("bottomDuration").textContent = service.duration;
  document.getElementById("bottomRevision").textContent = service.revision_count;

  const offer = (service.offer_items || "")
    .split("\n")
    .filter(v => v.trim());

  document.getElementById("sideOffer").innerHTML =
    `<ul>${offer.map(v => `<li>${v}</li>`).join("")}</ul>`;
  document.getElementById("bottomOffer").innerHTML =
    `<ul>${offer.map(v => `<li>${v}</li>`).join("")}</ul>`;
}

/* ======================================================
   서비스 상세 로딩
====================================================== */
async function loadService() {
  try {
    const res = await fetch(`${API}/services/${serviceId}`);
    const data = await res.json();

    const svc = data.service;
    const expert = data.expert || {};

    window.serviceTaskKey = svc.task_key || null;

    document.getElementById("heroTitle").textContent = svc.title;
    document.getElementById("heroMainCat").textContent = svc.main_category;
    document.getElementById("heroSubCat").textContent = svc.sub_category;

    const wrap = document.getElementById("keywordWrap");
    wrap.innerHTML = "";
    (svc.keywords || "").split(",").forEach(k => {
      if (!k.trim()) return;
      const chip = document.createElement("span");
      chip.className = "keyword-chip";
      chip.textContent = "#" + k.trim();
      wrap.appendChild(chip);
    });

    slideImgs = safeParse(svc.main_images) || [];
    const main = document.getElementById("mainSlideImg");
    main.src = slideImgs[0] || "/assets/default_service.png";

    const thumb = document.getElementById("thumbRow");
    thumb.innerHTML = "";
    slideImgs.forEach((img, i) => {
      const t = document.createElement("img");
      t.src = img;
      if (i === 0) t.classList.add("active");
      t.onclick = () => {
        main.src = img;
        document.querySelectorAll("#thumbRow img")
          .forEach(x => x.classList.remove("active"));
        t.classList.add("active");
      };
      thumb.appendChild(t);
    });

    document.getElementById("descText").innerHTML =
      (svc.description || "").replace(/\n/g, "<br>");
    document.getElementById("brandText").innerHTML =
      (svc.brand_concept || "").replace(/\n/g, "<br>");
    document.getElementById("processText").innerHTML =
      (svc.process || "").replace(/\n/g, "<br>");

    initExpertBox(expert);
    window.expertId = expert.user_id;

    renderSinglePrice(svc);

  } catch (err) {
    console.error(err);
    showToast("서비스 정보를 불러오지 못했습니다.");
  }
}

/* ======================================================
   탭 이동
====================================================== */
function initTabs() {
  document.querySelectorAll(".tab-nav").forEach(tab => {
    tab.onclick = () => {
      const target = document.getElementById(tab.dataset.target);
      if (!target) return;
      window.scrollTo({
        top: target.offsetTop - 90,
        behavior: "smooth"
      });
    };
  });
}

/* ======================================================
   초기화
====================================================== */
document.addEventListener("DOMContentLoaded", async () => {
  await loadService();
  initTabs();
  initBuyButtons();
});
