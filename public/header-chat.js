console.log("🔵 header-chat.js loaded");

/* =========================================================
   공통 설정
========================================================= */
const chatBadge   = document.getElementById("chatBadge");
const openChatBtn = document.getElementById("openChat");

if (chatBadge) chatBadge.style.display = "none";

let CURRENT_USER = null;
let socket = null;

/* =========================================================
   유틸: 현재 채팅 페이지 여부
========================================================= */
function isChatPage() {
  return location.pathname.includes("chat.html");
}

/* =========================================================
   1️⃣ 로그인 유저 정보
========================================================= */
async function loadHeaderUser() {
  try {
    const res = await fetch(`${API_URL}/auth/me`, {
      credentials: "include",
      cache: "no-store",
    });
    const data = await res.json();

    if (data?.success && data.user) {
      CURRENT_USER = data.user;
      console.log("🟢 header user loaded:", CURRENT_USER.id);
      return true;
    }
  } catch (e) {
    console.error("❌ header user load fail:", e);
  }
  return false;
}

/* =========================================================
   2️⃣ 🔴 안 읽은 채팅 배지 (서버 기준)
========================================================= */
async function syncChatBadge() {
  if (!chatBadge || !CURRENT_USER) return;

  // 🔥 채팅 페이지에서는 배지 갱신 자체를 하지 않음
  if (isChatPage()) {
    chatBadge.style.display = "none";
    return;
  }

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
  } catch (e) {
    console.warn("⚠️ unread-count fail", e);
  }
}

/* =========================================================
   3️⃣ 💬 채팅 아이콘 클릭 → 최근 채팅
========================================================= */
async function openLatestChatRoom() {
  try {
    const res = await fetch(`${API_URL}/chat/rooms`, {
      credentials: "include",
      cache: "no-store",
    });
    const data = await res.json();

    if (!data?.success || !data.rooms?.length) {
      location.href = "/chat.html";
      return;
    }

    location.href = `/chat.html?room=${data.rooms[0].room_id}`;
  } catch {
    location.href = "/chat.html";
  }
}

/* =========================================================
   4️⃣ 🔥 헤더 소켓 (배지 전용)
========================================================= */
async function initHeaderChat() {
  const ok = await loadHeaderUser();
  if (!ok) return;

  // 최초 1회만 동기화 (채팅 페이지 제외)
  await syncChatBadge();

  // 🔄 폴링 (채팅 페이지 제외)
  setInterval(syncChatBadge, 5000);

  if (openChatBtn) {
    openChatBtn.addEventListener("click", openLatestChatRoom);
  }

  /* =====================================================
     Socket.IO
  ===================================================== */
  socket = io(API_URL, {
    withCredentials: true,
  });

  socket.on("connect", () => {
    console.log("🟦 header socket connected:", socket.id);

    socket.emit("join:user", {
      userId: CURRENT_USER.id
    });
  });

  socket.on("connect_error", (err) => {
    console.warn("⚠️ header socket error:", err?.message || err);
  });

  socket.on("disconnect", (reason) => {
    console.log("🔻 header socket disconnected:", reason);
  });

  /* =====================================================
     📩 새 메시지 알림
  ===================================================== */
  socket.on("chat:notify", (payload) => {
    console.log("📩 header chat notify:", payload);

    // 🔥 내가 채팅 페이지에 있으면 배지 표시 ❌
    if (isChatPage()) return;

    // 🔴 배지 표시
    chatBadge.style.display = "block";

    // 서버 기준 재확인
    syncChatBadge();
  });
}

/* =========================================================
   외부에서 호출 가능 (chat.html에서 사용)
========================================================= */
window.refreshHeaderBadge = syncChatBadge;

/* =========================================================
   실행
========================================================= */
initHeaderChat();
