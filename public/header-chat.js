console.log("🔵 header-chat.js loaded");

/* =========================================================
   ✅ 공통 설정
========================================================= */
const API_URL = "https://blueon.up.railway.app";

const chatBadge   = document.getElementById("chatBadge");
const openChatBtn = document.getElementById("openChat");

if (chatBadge) chatBadge.style.display = "none";

let CURRENT_USER = null;
let socket = null;

/* =========================================================
   1️⃣ 로그인 유저 정보 로드
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
      console.log("🟢 header user loaded:", CURRENT_USER);
      return true;
    }
  } catch (err) {
    console.error("❌ header user load 실패:", err);
  }
  return false;
}

/* =========================================================
   2️⃣ 🔴 안 읽은 채팅 배지 동기화
========================================================= */
async function syncChatBadge() {
  if (!chatBadge || !CURRENT_USER) return;

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
    console.error("❌ unread-count 실패:", err);
  }
}

/* =========================================================
   3️⃣ 💬 채팅 아이콘 클릭
   - 기존 채팅 있으면 가장 최근 채팅방으로 이동
   - 없으면 chat.html 기본 진입
========================================================= */
async function openLatestChatRoom() {
  try {
    const res = await fetch(`${API_URL}/chat/rooms`, {
      credentials: "include",
      cache: "no-store",
    });
    const data = await res.json();

    // ❌ 채팅 없음
    if (!data?.success || !data.rooms || data.rooms.length === 0) {
      location.href = "/chat.html";
      return;
    }

    // ✅ 가장 최근 채팅방
    const room = data.rooms[0];

    location.href = `/chat.html?room=${room.room_id}&target=${room.other_id}`;
  } catch (err) {
    console.error("❌ 채팅방 이동 실패:", err);
    location.href = "/chat.html";
  }
}

/* =========================================================
   4️⃣ 🔥 헤더 전용 소켓 초기화
========================================================= */
async function initHeaderChat() {
  const ok = await loadHeaderUser();
  if (!ok) return;

  // 최초 배지 동기화
  syncChatBadge();

  // 🔄 폴링 백업 (소켓 죽어도 배지 유지)
  setInterval(syncChatBadge, 5000);

  // 💬 채팅 아이콘 클릭
  openChatBtn?.addEventListener("click", openLatestChatRoom);

  // ✅ Socket.IO (같은 도메인, Mixed Content 방지)
  socket = io({
    path: "/socket.io",
    withCredentials: true,
    transports: ["polling"], // Railway 안정 모드
    upgrade: false,
  });

  socket.on("connect", () => {
    console.log("🟦 header socket connected:", socket.id);

    // 🔥 핵심: 로그인 유저 전용 room join
    if (CURRENT_USER?.id) {
      socket.emit("user:join", CURRENT_USER.id);
      console.log("👤 user room joined:", CURRENT_USER.id);
    }
  });

  socket.on("disconnect", (reason) => {
    console.log("🔻 header socket disconnected:", reason);
  });

  socket.on("connect_error", (err) => {
    console.warn("⚠️ header socket error:", err?.message || err);
  });

  /* =====================================================
     📩 새 메시지 알림 수신
     - index.html 빨간 점 표시
  ===================================================== */
  socket.on("chat:notify", (payload) => {
    if (!payload || !CURRENT_USER) return;
    if (Number(payload.targetId) !== Number(CURRENT_USER.id)) return;

    console.log("📩 header chat notify received:", payload);
    syncChatBadge();
  });
}

/* =========================================================
   실행
========================================================= */
initHeaderChat();
