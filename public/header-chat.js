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
let HEADER_BADGE_TIMER = null;

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
   🔥 헤더 전용 socket.io (배지 동기화 트리거)
========================================================= */
async function initHeaderChat() {
  const ok = await loadHeaderUser();
  if (!ok) {
    console.warn("⚠️ header user not logged in -> header chat disabled");
    return;
  }

  // 최초 동기화
  syncHeaderChatBadge();

  // 🔁 보조 안전장치 (소켓이 죽어도 배지 유지)
  if (HEADER_BADGE_TIMER) clearInterval(HEADER_BADGE_TIMER);
  HEADER_BADGE_TIMER = setInterval(syncHeaderChatBadge, 5000);

  // ✅ 도메인 명시: 현재 페이지 도메인이 아니라 Railway API로 무조건 붙음
  if (typeof window.io !== "function") {
    console.warn("❌ socket.io not loaded (window.io undefined)");
    return;
  }

  headerSocket = window.io(API_URL, {
    path: "/socket.io",
    withCredentials: true,
    transports: ["polling", "websocket"],
    upgrade: true,
    reconnection: true,
    reconnectionAttempts: 20,
    reconnectionDelay: 800,
    timeout: 10000,
  });

  headerSocket.on("connect", () => {
    console.log("🟦 header socket connected:", headerSocket.id, "uid=", HEADER_CURRENT_USER?.id);
  });

  headerSocket.on("disconnect", (reason) => {
    console.log("🔻 header socket disconnected:", reason);
  });

  headerSocket.on("connect_error", (err) => {
    console.warn("⚠️ header socket connect_error:", err?.message || err);
  });

  // ✅ 서버가 실제로 쏘는 이벤트를 받는다 (핵심)
  // - /chat/send-message에서 io.to(roomId) + io.to(user:target) 로 emit("chat:message")
  headerSocket.on("chat:message", (msg) => {
    if (!HEADER_CURRENT_USER) return;

    // 내가 보낸 메시지면 굳이 배지 갱신 안 해도 됨(원하면 이 줄 삭제)
    if (msg && Number(msg.sender_id) === Number(HEADER_CURRENT_USER.id)) return;

    console.log("📩 header received chat:message -> sync badge");
    syncHeaderChatBadge();
  });

  // (선택) 추후 서버에서 이런 이벤트를 추가하면 같이 받을 수 있게
  headerSocket.on("chat:unread:changed", () => {
    syncHeaderChatBadge();
  });

  // 포커스/탭 복귀 시 동기화 (모바일/백그라운드 대응)
  window.addEventListener("focus", syncHeaderChatBadge);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) syncHeaderChatBadge();
  });
}

/* =========================================================
   실행
========================================================= */
initHeaderChat();
