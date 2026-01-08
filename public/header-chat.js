console.log("🔵 header-chat.js loaded");

const API_URL = "https://blueon.up.railway.app";

const chatBadge = document.getElementById("chatBadge");
if (chatBadge) chatBadge.style.display = "none";

let CURRENT_USER = null;

/* ============================
   사용자 정보
============================ */
async function loadHeaderUser() {
  try {
    const res = await fetch(`${API_URL}/auth/me`, {
      credentials: "include",
      cache: "no-store",
    });
    const data = await res.json();

    if (data?.success && data?.user) {
      CURRENT_USER = data.user;
      return true;
    }
  } catch (err) {
    console.error("❌ header user load fail:", err);
  }
  return false;
}

/* ============================
   🔔 안 읽은 채팅 배지
============================ */
async function syncChatBadge() {
  if (!chatBadge || !CURRENT_USER) return;

  try {
    const res = await fetch(`${API_URL}/chat/unread-count`, {
      credentials: "include",
      cache: "no-store",
    });
    const data = await res.json();

    chatBadge.style.display =
      data?.success && Number(data.total) > 0 ? "block" : "none";
  } catch (err) {
    console.error("❌ unread-count error:", err);
  }
}

/* ============================
   🔥 헤더 전용 소켓
============================ */
async function initHeaderChat() {
  const ok = await loadHeaderUser();
  if (!ok) return;

  // 최초 1회
  syncChatBadge();

  // 보조 폴링
  setInterval(syncChatBadge, 5000);

  // ⚠️ 같은 도메인 상대 경로 연결 (정석)
  const socket = io({
    path: "/socket.io",
    withCredentials: true,
    transports: ["polling", "websocket"], // ← 개선
    upgrade: true,
  });

  socket.on("connect", () => {
    console.log("🟦 header socket connected:", socket.id);
  });

  socket.on("disconnect", (reason) => {
    console.log("🔻 header socket disconnected:", reason);
  });

  socket.on("connect_error", (err) => {
    console.warn("⚠️ header socket error:", err?.message || err);
  });

  // 📩 채팅 알림
  socket.on("chat:notify", (data) => {
    if (!data || !CURRENT_USER) return;
    if (Number(data.targetId) !== Number(CURRENT_USER.id)) return;

    console.log("📩 header chat notify");
    syncChatBadge();
  });
}

/* ============================
   실행
============================ */
initHeaderChat();
