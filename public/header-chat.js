console.log("🔵 header-chat.js loaded");

const API = "https://blueon.up.railway.app";

const chatBadge = document.getElementById("chatBadge");
if (chatBadge) chatBadge.style.display = "none";

let CURRENT_USER = null;

/* ============================
   사용자 최소 정보 로드
============================ */
async function loadHeaderUser() {
  try {
    const res = await fetch(`${API}/auth/me`, {
      credentials: "include"
    });
    const data = await res.json();

    if (data.success && data.user) {
      CURRENT_USER = data.user;
      console.log("🟢 로그인된 사용자:", CURRENT_USER);
      return true;
    }
  } catch (err) {
    console.error("❌ 사용자 정보 로드 실패:", err);
  }
  return false;
}

/* ============================
   🔔 안 읽은 채팅 배지 갱신
============================ */
async function syncChatBadge() {
  if (!chatBadge || !CURRENT_USER) return;

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
   🔥 헤더 전용 소켓 초기화
============================ */
async function initHeaderChat() {
  const ok = await loadHeaderUser();
  if (!ok) return;

  // ✅ 최초 1회 동기화
  syncChatBadge();

  // ✅ 소켓이 죽어도 배지는 유지 (보조 안전장치)
  setInterval(syncChatBadge, 5000);

  // ✅ 서버 설정과 완전히 동일하게 맞춤
  const socket = io(API, {
    transports: ["websocket"],   // 🔥 핵심
    withCredentials: true
  });

  socket.on("connect", () => {
    console.log("🟦 header socket 연결:", socket.id);
  });

  socket.on("disconnect", (reason) => {
    console.log("🔻 header socket 끊김:", reason);
  });

  socket.on("connect_error", (err) => {
    console.warn("⚠️ header socket 오류:", err.message);
  });

  // 📩 채팅 알림 수신
  socket.on("chat:notify", (data) => {
    if (!data) return;
    if (!CURRENT_USER) return;
    if (Number(data.targetId) !== Number(CURRENT_USER.id)) return;

    console.log("📩 채팅 알림 수신");
    syncChatBadge();
  });
}

/* ============================
   실행
============================ */
initHeaderChat();
