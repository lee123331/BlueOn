/*******************************************************
 🔵 HEADER CHAT JS — SAFE FINAL VERSION
    (중복 선언/중복 실행/충돌 모두 해결된 버전)
*******************************************************/

console.log("🔵 header-chat.js loaded");

/* ======================================================
   🔥 API URL 선언 (전역에서 1번만 선언)
====================================================== */
if (typeof window.API === "undefined") {
  window.API = "https://blueon.up.railway.app";
}

/* 로그인 사용자 정보 */
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
      CURRENT_USER = null;
      console.log("🔴 비로그인 상태 — 채팅 알림 비활성화");
    }

  } catch (err) {
    console.error("❌ 사용자 정보 로드 실패:", err);
  }
}

/* ======================================================
   2) 소켓 연결 초기화
====================================================== */
async function initHeaderChat() {
  await loadHeaderUser();

  // 로그인 안 된 경우 소켓 연결 X
  if (!CURRENT_USER) {
    console.log("⛔ 로그인되지 않아 소켓 연결 안 함");
    return;
  }

  console.log("⚡ 소켓 접속 준비:", CURRENT_USER.id);

  /* --------------------------------------------------
     소켓 연결 (인증 포함)
  -------------------------------------------------- */
  const headerSocket = io(API, {
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
     3) "새 메시지 알림(chat:notify)" 수신
  ======================================================= */
  const chatBadge = document.getElementById("chatBadge");

  headerSocket.on("chat:notify", (data) => {
    console.log("📩 chat:notify 도착:", data);

    if (!data || data.targetId !== CURRENT_USER.id) {
      console.log("➡️ 내 알림이 아님 (무시)");
      return;
    }

    console.log("🔥 새 메시지 알림 → 배지 표시");
    if (chatBadge) chatBadge.style.display = "block";
  });

  /* ======================================================
     4) 채팅 아이콘 클릭 시 배지 제거
  ======================================================= */
  const openChatBtn = document.getElementById("openChat");
  if (openChatBtn) {
    openChatBtn.addEventListener("click", () => {
      if (chatBadge) chatBadge.style.display = "none";
    });
  }
}

/* ======================================================
   5) 중복 실행 방지 후 초기 실행
====================================================== */
if (!window._headerChatInitialized) {
  window._headerChatInitialized = true;
  initHeaderChat();
}
