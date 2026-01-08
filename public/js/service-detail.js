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
   🔥 문의하기 (서비스 문의 채팅)
   service_chat_rooms 기반
====================================================== */
window.openChat = async function () {
  if (!serviceId) {
    showToast("서비스 정보가 없습니다.");
    return;
  }

  try {
    const res = await fetch(`${API}/service-chat/start`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ serviceId })
    });

    const data = await res.json();
    console.log("🧪 /service-chat/start result:", data);

    if (!data.success || !data.roomId) {
      showToast("채팅방 생성에 실패했습니다.");
      return;
    }

    // ✅ 서비스 문의 전용 채팅 페이지로 이동
    location.href = `/service-chat.html?roomId=${data.roomId}`;

  } catch (err) {
    console.error("❌ openChat error:", err);
    showToast("채팅 연결 중 오류가 발생했습니다.");
  }
};

/* ======================================================
   구매 버튼
====================================================== */
function initBuyButtons() {
  document.querySelectorAll(".btn-buy, .price-buy-btn")
    .forEach(btn => {
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

          const data = await res.json();

          if (data.orderId) {
            location.href = `/order-pay.html?orderId=${data.orderId}`;
          } else {
            showToast(data.message || "주문 생성 실패");
          }
        } catch (e) {
          console.error(e);
          showToast("주문 처리 중 오류가 발생했습니다.");
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
   🔥 서비스 상세 로딩 (핵심 수정 완료본)
====================================================== */
async function loadService() {
  try {
    const res = await fetch(`${API}/services/${serviceId}`, {
      credentials: "include"
    });
    const data = await res.json();

    if (!data || !data.service) {
      showToast("서비스 정보를 불러오지 못했습니다.");
      return;
    }

    const svc = data.service;
    const expert = data.expert || {};

    document.getElementById("heroTitle").textContent = svc.title;
    document.getElementById("heroMainCat").textContent = svc.main_category;
    document.getElementById("heroSubCat").textContent = svc.sub_category;

    slideImgs = safeParse(svc.main_images) || [];
    document.getElementById("mainSlideImg").src =
      slideImgs[0] || "/assets/default_service.png";

    initExpertBox(expert);
    renderSinglePrice(svc);

  } catch (err) {
    console.error(err);
    showToast("서비스 정보를 불러오지 못했습니다.");
  }
}

/* ======================================================
   초기화
====================================================== */
document.addEventListener("DOMContentLoaded", async () => {
  await loadService();
  initBuyButtons();
});
