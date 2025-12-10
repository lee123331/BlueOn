console.log("🔵 header-chat.js loaded");

/* ======================================================
   🔥 API URL 선언 (필수)
====================================================== */
const API = "https://blueon.up.railway.app";

// 로그인 사용자 정보
let CURRENT_USER = null;

/* ======================================================
   1) 로그인 사용자 로드
====================================================== */
async function loadHeaderUser() {
  try {
    const res = await fetch(`${API}/auth/me`, {
      credentials: "include"
    });

    const data = await res.json();

    if (data.success) {
      CURRENT_USER = data.user;
      console.log("🟢 로그인된 사용자:", CURRENT_USER);
    } else {
      console.log("🔴 비로그인 상태 — 채팅 알림 비활성화");
    }
  } catch (err) {
    console.error("❌ 사용자 정보 로드 실패:", err);
  }
}

/* ======================================================
   2) 초기화 — 유저정보 로드 후 소켓 연결
====================================================== */
async function initHeaderChat() {
  await loadHeaderUser();

  // 로그인 안 되어 있으면 소켓 연결 불필요
  if (!CURRENT_USER) return;

  console.log("⚡ 소켓 접속 준비:", CURRENT_USER.id);

  // 🔥 사용자 ID 포함해서 소켓 연결
  const headerSocket = io("https://blueon.up.railway.app", {
    withCredentials: true,
    auth: { userId: CURRENT_USER.id }
  });

  headerSocket.on("connect", () => {
    console.log("🟦 header 소켓 연결됨:", headerSocket.id);
  });

  headerSocket.on("disconnect", () => {
    console.log("🔻 header 소켓 끊김");
  });

  /* ======================================================
     3) 알림(chat:notify) 수신
  ======================================================= */
  const chatBadge = document.getElementById("chatBadge");

  headerSocket.on("chat:notify", (data) => {
    console.log("📩 chat:notify 도착:", data);

    const { targetId } = data;

    if (targetId !== CURRENT_USER.id) {
      console.log("➡️ 내 알림이 아님 (무시)");
      return;
    }

    console.log("🔥 새 메시지 알림 감지 → 배지 표시");
    chatBadge.style.display = "block";
  });

  /* ======================================================
     4) 채팅 아이콘 클릭 시 배지 제거
  ======================================================= */
  const openChatBtn = document.getElementById("openChat");
  if (openChatBtn) {
    openChatBtn.addEventListener("click", () => {
      chatBadge.style.display = "none";
    });
  }
}

// 초기 실행
initHeaderChat();
