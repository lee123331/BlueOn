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
   🔥 문의하기 (채팅방 생성 → 이동)
====================================================== */
window.openChat = async function () {
  const targetId = window.SERVICE_EXPERT_ID;

  if (!targetId) {
    showToast("전문가 정보를 불러오는 중입니다.");
    return;
  }

  try {
    const res = await fetch("/chat/start", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetId })
    });

    const data = await res.json();
    console.log("🧪 chat/start result:", data);

    if (!data.success || !data.roomId) {
      showToast("채팅방 생성에 실패했습니다.");
      return;
    }

    // ✅ 여기서만 이동
    location.href = `/chat.html?room=${data.roomId}`;

  } catch (e) {
    console.error(e);
    showToast("채팅 연결 중 오류가 발생했습니다.");
  }
};


/* ======================================================
   구매 버튼
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

        if (!res.ok) {
          showToast("서버 통신 오류가 발생했습니다.");
          return;
        }

        const data = await res.json();

        if (data.orderId) {
          if (data.code === "DUPLICATE_PENDING") {
            showToast("이미 입금 대기 중인 주문이 있습니다.");
          }
          location.href = `/order-pay.html?orderId=${data.orderId}`;
          return;
        }

        showToast(data.message || "주문 생성에 실패했습니다.");

      } catch (err) {
        console.error(err);
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
// 예시: 서비스 데이터 로드 후
window.TARGET_USER_ID = service.expert_user_id; // 🔥 이 줄 반드시

/* ======================================================
   가격 렌더링
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

    // 🔥 채팅용 전문가 ID 전역 저장 (이게 핵심)
    window.SERVICE_EXPERT_ID = expert.user_id;

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
