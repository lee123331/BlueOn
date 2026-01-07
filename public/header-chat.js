console.log("🔵 header-chat.js loaded");

/* =========================================================
   전역 공통 API_URL 사용 (중복 선언 ❌)
========================================================= */
const API_URL = window.API_URL;

/* =========================================================
   DOM
========================================================= */
const chatBadge = document.getElementById("chatBadge");
if (chatBadge) chatBadge.style.display = "none";

let CURRENT_USER = null;

/* =========================================================
   사용자 최소 정보 로드
========================================================= */
async function loadHeaderUser() {
  try {
    const res = await fetch(`${API_URL}/auth/me`, {
      credentials: "include",
      cache: "no-store",
    });
    const data = await res.json();

    if (data?.success && data?.user) {
      CURRENT_USER = data.user;
      console.log("🟢 로그인된 사용자:", CURRENT_USER);
      return true;
    }
  } catch (err) {
    console.error("❌ 사용자 정보 로드 실패:", err);
  }
  return false;
}

/* =========================================================
   🔔 안 읽은 채팅 배지 갱신
========================================================= */
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
    console.error("❌ unread-count 실패:", err);
  }
}

/* =========================================================
   🔥 헤더 전용 소켓 초기화
   - URL 명시 ❌ (Mixed Content 방지)
   - 같은 도메인 기준 상대 연결
========================================================= */
async function initHeaderChat() {
  const ok = await loadHeaderUser();
  if (!ok) return;

  // 최초 1회 동기화
  syncChatBadge();

  // 소켓 죽어도 배지는 유지 (보험)
  setInterval(syncChatBadge, 5000);

  const socket = io({
    path: "/socket.io",
    withCredentials: true,
    transports: ["polling"], // Railway 환경 최안정
    upgrade: false,
  });

  socket.on("connect", () => {
    console.log("🟦 header socket 연결:", socket.id);
  });

  socket.on("disconnect", (reason) => {
    console.log("🔻 header socket 끊김:", reason);
  });

  socket.on("connect_error", (err) => {
    console.warn("⚠️ header socket 오류:", err?.message || err);
  });

  // 📩 채팅 알림 수신
  socket.on("chat:notify", (data) => {
    if (!data || !CURRENT_USER) return;
    if (Number(data.targetId) !== Number(CURRENT_USER.id)) return;

    console.log("📩 채팅 알림 수신");
    syncChatBadge();
  });
}

/* =========================================================
   실행
========================================================= */
initHeaderChat();
