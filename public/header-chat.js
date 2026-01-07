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

  // 최초 동기화
  await syncChatBadge();

  // 🔄 안전망 (소켓 죽어도 복구)
  setInterval(syncChatBadge, 5000);

  if (openChatBtn) {
    openChatBtn.addEventListener("click", openLatestChatRoom);
  }

  /* =====================================================
     Socket.IO
     ⚠️ 이벤트 이름을 서버와 100% 일치시킨다
  ===================================================== */
  socket = io(API_URL, {
    withCredentials: true,
  });

  socket.on("connect", () => {
    console.log("🟦 header socket connected:", socket.id);

    // 🔥🔥🔥 핵심: 서버가 이 이벤트를 받아야 한다
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
     - 서버에서 이미 "나에게 온 것만" 보내는 구조
     - 프론트에서 추가 필터링 ❌
  ===================================================== */
  socket.on("chat:notify", (payload) => {
    console.log("📩 header chat notify:", payload);

    // 🔴 즉시 표시
    chatBadge.style.display = "block";

    // 🔄 서버 unread 기준으로 재동기화
    syncChatBadge();
  });
}

/* =========================================================
   실행
========================================================= */
initHeaderChat();
