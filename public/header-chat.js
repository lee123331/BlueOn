console.log("🔵 header-chat.js loaded");

/* ======================================================
   🔥 API URL 선언
====================================================== */
const API = "https://blueon.up.railway.app";

/* 🔔 알림 배지 강제 초기화 */
const chatBadge = document.getElementById("chatBadge");
if (chatBadge) {
  chatBadge.style.display = "none";
}

/* 로그인된 사용자 정보 */
let CURRENT_USER = null;

/* ======================================================
   1) 최소 정보만 로드 (세션 기반)
====================================================== */
async function loadHeaderUserLight() {
  try {
    const res = await fetch(`${API}/auth/me`, { credentials: "include" });
    const data = await res.json();

    if (data.success) {
      CURRENT_USER = data.user;
      console.log("🟢 로그인된 사용자:", CURRENT_USER);
    } else {
      CURRENT_USER = null;
    }
  } catch (err) {
    console.error("❌ 사용자 정보 로드 실패:", err);
  }
}

/* ======================================================
   2) 소켓 초기화 (모든 페이지)
====================================================== */
async function initHeaderChat() {
  await loadHeaderUserLight();

  if (!CURRENT_USER) {
    console.log("🔴 로그인 안 된 상태 → 소켓 미연결");
    return;
  }

  const headerSocket = io(API, {
    withCredentials: true,
    auth: { userId: CURRENT_USER.id }
  });

  headerSocket.on("connect", () => {
    console.log("🟦 header 소켓 연결됨:", headerSocket.id);
  });

  headerSocket.on("disconnect", () => {
    console.log("🔻 header 소켓 끊김");
  });

  /* 🔔 알림 이벤트 */
  headerSocket.on("chat:notify", (data) => {
    if (!data || data.targetId !== CURRENT_USER.id) return;
    console.log("📩 새 알림 → 배지 표시");
    if (chatBadge) chatBadge.style.display = "block";
  });
}

/* ======================================================
   🚀 항상 실행 (정답)
====================================================== */
initHeaderChat();
