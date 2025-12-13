console.log("🔵 header-chat.js loaded");

const API = "https://blueon.up.railway.app";

/* 🔔 알림 배지 강제 초기화 */
const chatBadge = document.getElementById("chatBadge");
if (chatBadge) {
  chatBadge.style.display = "none";
}

let CURRENT_USER = null;

/* ============================
   사용자 최소 정보 로드
============================ */
async function loadHeaderUserLight() {
  try {
    const res = await fetch(`${API}/auth/me`, { credentials: "include" });
    const data = await res.json();

    if (data.success) {
      CURRENT_USER = data.user;
      console.log("🟢 로그인된 사용자:", CURRENT_USER);
    }
  } catch (err) {
    console.error("❌ 사용자 정보 로드 실패:", err);
  }
}

/* ============================
   🔥 헤더 전용 소켓 (polling only)
============================ */
async function initHeaderChat() {
  await loadHeaderUserLight();

  if (!CURRENT_USER) return;

  const socket = io(API, {
    withCredentials: true,
    transports: ["polling"],   // ⭐ 핵심
    upgrade: false              // ⭐ 핵심
  });

  socket.on("connect", () => {
    console.log("🟦 header polling socket 연결됨:", socket.id);
  });

  socket.on("disconnect", () => {
    console.log("🔻 header polling socket 끊김");
  });

  socket.on("chat:notify", (data) => {
    if (!data || data.targetId !== CURRENT_USER.id) return;
    console.log("📩 헤더 알림 수신");
    if (chatBadge) chatBadge.style.display = "block";
  });
}

initHeaderChat();
