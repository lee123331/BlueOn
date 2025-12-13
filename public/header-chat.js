console.log("🔵 header-chat.js loaded");

const API = "https://blueon.up.railway.app";

const chatBadge = document.getElementById("chatBadge");
if (chatBadge) chatBadge.style.display = "none";

let CURRENT_USER = null;

/* ============================
   🔵 unread 상태 기준으로 배지 갱신
============================ */
async function refreshChatBadge() {
  if (!chatBadge) return;

  try {
    const res = await fetch(`${API}/chat/unread-count`, {
      credentials: "include"
    });
    const data = await res.json();

    if (data.success && data.total > 0) {
      chatBadge.style.display = "block";
    } else {
      chatBadge.style.display = "none";
    }
  } catch (err) {
    console.error("❌ unread-count 실패:", err);
  }
}

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
   🔥 헤더 전용 소켓
============================ */
async function initHeaderChat() {
  await loadHeaderUserLight();
  if (!CURRENT_USER) return;

  // 🔥 최초 로드시 unread 기준으로 표시
  await refreshChatBadge();

  const socket = io(API, {
    withCredentials: true,
    transports: ["polling"],
    upgrade: false
  });

  socket.on("connect", () => {
    console.log("🟦 header socket 연결:", socket.id);
  });

  socket.on("disconnect", () => {
    console.log("🔻 header socket 끊김");
  });

  // 🔔 새 메시지 알림 → DB 기준으로 다시 판단
  socket.on("chat:notify", async (data) => {
    if (!data || data.targetId !== CURRENT_USER.id) return;
    console.log("📩 헤더 알림 수신");
    await refreshChatBadge();
  });
}

initHeaderChat();
