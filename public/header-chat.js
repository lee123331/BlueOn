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
let isSocketReady = false;

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

    if (data && data.success && data.user) {
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

    console.log("🔍 unread-count response:", data);

    if (data && data.success && Number(data.total) > 0) {
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
========================================================= */
async function openLatestChatRoom() {
  try {
    const res = await fetch(`${API_URL}/chat/rooms`, {
      credentials: "include",
      cache: "no-store",
    });

    const data = await res.json();

    if (!data || !data.success || !Array.isArray(data.rooms) || data.rooms.length === 0) {
      location.href = "/chat.html";
      return;
    }

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
  await syncChatBadge();

  // 🔄 안전 폴링 (소켓 죽어도 배지 유지)
  setInterval(syncChatBadge, 5000);

  // 💬 채팅 버튼 클릭
  if (openChatBtn) {
    openChatBtn.addEventListener("click", openLatestChatRoom);
  }

  /* =====================================================
     Socket.IO 연결
  ===================================================== */
  socket = io({
    path: "/socket.io",
    withCredentials: true,
    transports: ["polling"],   // Railway 안정 모드
    upgrade: false,
  });

  socket.on("connect", () => {
    console.log("🟦 header socket connected:", socket.id);

    if (CURRENT_USER && CURRENT_USER.id) {
      
      console.log("👤 user room joined: user:" + CURRENT_USER.id);
      isSocketReady = true;
    }
  });

  socket.on("disconnect", (reason) => {
    console.log("🔻 header socket disconnected:", reason);
    isSocketReady = false;
  });

  socket.on("connect_error", (err) => {
    console.warn("⚠️ header socket error:", err?.message || err);
  });

  /* =====================================================
     📩 새 메시지 알림 수신
  ===================================================== */
  socket.on("chat:notify", (payload) => {
    if (!payload || !CURRENT_USER) return;

    const targetId = Number(payload.targetId);
    const myId     = Number(CURRENT_USER.id);

    if (targetId !== myId) return;

    console.log("📩 header chat notify received:", payload);

    // 🔴 배지 즉시 반영
    chatBadge.style.display = "block";

    // 🔄 서버 기준 동기화
    syncChatBadge();
  });
}

/* =========================================================
   실행
========================================================= */
initHeaderChat();
