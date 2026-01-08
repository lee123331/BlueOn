console.log("🔵 header-chat.js (FINAL) loaded");

/* =========================================================
   공통 설정
========================================================= */
const API_URL = "https://blueon.up.railway.app";

const chatBadge = document.getElementById("chatBadge");
if (chatBadge) chatBadge.style.display = "none";

/* ⚠️ chat.js 와 절대 겹치지 않게 이름 분리 */
let HEADER_CURRENT_USER = null;
let headerSocket = null;

/* =========================================================
   사용자 정보 (헤더용 최소 정보)
========================================================= */
async function loadHeaderUser() {
  try {
    const res = await fetch(`${API_URL}/auth/me`, {
      credentials: "include",
      cache: "no-store",
    });
    const data = await res.json();

    if (data?.success && data?.user) {
      HEADER_CURRENT_USER = data.user;
      return true;
    }
  } catch (err) {
    console.error("❌ header user load fail:", err);
  }
  return false;
}

/* =========================================================
   🔔 안 읽은 채팅 배지 갱신
========================================================= */
async function syncHeaderChatBadge() {
  if (!chatBadge || !HEADER_CURRENT_USER) return;

  try {
    const res = await fetch(`${API_URL}/chat/unread-count`, {
      credentials: "include",
      cache: "no-store",
    });
    const data = await res.json();

    if (data?.success && Number(data.total) > 0) {
      chatBadge.style.display = "block";
    } else {
      chatBadge.style.display = "none";
    }
  } catch (err) {
    console.error("❌ unread-count error:", err);
  }
}

/* =========================================================
   🔥 헤더 전용 socket.io (알림만)
========================================================= */
async function initHeaderChat() {
  const ok = await loadHeaderUser();
  if (!ok) return;

  // 최초 동기화
  syncHeaderChatBadge();

  // 🔁 보조 안전장치 (소켓 끊겨도 배지 유지)
  setInterval(syncHeaderChatBadge, 5000);

  // ⚠️ 같은 도메인 상대 경로 연결 (Mixed Content 방지)
  headerSocket = io({
    path: "/socket.io",
    withCredentials: true,
    transports: ["polling", "websocket"],
    upgrade: true,
  });

  headerSocket.on("connect", () => {
    console.log("🟦 header socket connected:", headerSocket.id);
  });

  headerSocket.on("disconnect", (reason) => {
    console.log("🔻 header socket disconnected:", reason);
  });

  headerSocket.on("connect_error", (err) => {
    console.warn("⚠️ header socket error:", err?.message || err);
  });

  /* 📩 채팅 알림 수신 */
  headerSocket.on("chat:notify", (data) => {
    if (!data || !HEADER_CURRENT_USER) return;
    if (Number(data.targetId) !== Number(HEADER_CURRENT_USER.id)) return;

    console.log("📩 header chat notify received");
    syncHeaderChatBadge();
  });
}

/* =========================================================
   실행
========================================================= */
initHeaderChat();
