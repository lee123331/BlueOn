console.log("🔥 chat.js 로딩됨");

const API_URL = "https://blueon.up.railway.app";

/* ======================================================
   URL 파라미터
====================================================== */
const params = new URLSearchParams(location.search);
let ROOM_ID = params.get("room"); // room만 신뢰 (target은 버림)

/* ======================================================
   DOM
====================================================== */
const chatBody     = document.getElementById("chatBody");
const msgInput     = document.getElementById("msgInput");
const sendBtn      = document.getElementById("sendBtn");
const fileBtn      = document.getElementById("fileBtn");
const fileInput    = document.getElementById("fileInput");
const chatListArea = document.getElementById("chatList");
const headerImg    = document.getElementById("chatProfileImg");
const headerName   = document.getElementById("chatProfileName");

let CURRENT_USER = null;
let socket = null;

/* ======================================================
   Utils
====================================================== */
async function safeJson(res) {
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("application/json")) {
    const t = await res.text().catch(() => "");
    throw new Error(`JSON 아님. status=${res.status} body=${t.slice(0, 120)}`);
  }
  return res.json();
}

function scrollBottom() {
  chatBody.scrollTop = chatBody.scrollHeight;
}

function setEmptyState(text = "대화를 선택해주세요") {
  headerName.textContent = "채팅";
  headerImg.src = "/assets/default_profile.png";
  chatBody.innerHTML = `<div style="padding:20px;color:#6b7280;">${text}</div>`;
}

function setHeaderProfile({ nickname, avatar }) {
  headerName.textContent = nickname || "상대방";
  headerImg.src = avatar || "/assets/default_profile.png";
}

/* ======================================================
   로그인 정보
====================================================== */
async function loadMe() {
  const res = await fetch(`${API_URL}/auth/me`, {
    credentials: "include",
    cache: "no-store",
  });
  const data = await safeJson(res);

  if (!data.success) {
    location.href = "/login.html";
    return false;
  }

  CURRENT_USER = data.user;
  return true;
}

/* ======================================================
   ✅ 채팅방 기준 상대방 프로필 (가장 중요)
   - target 파라미터를 믿지 않는다
====================================================== */
async function loadRoomOtherProfile(roomId) {
  // 1) 서버가 /chat/room-info 지원하면 그걸 최우선 사용
  //    (권장: roomId 기준으로 other_id/nickname/avatar 내려주기)
  try {
    const res = await fetch(`${API_URL}/chat/room-info?roomId=${encodeURIComponent(roomId)}`, {
      credentials: "include",
      cache: "no-store",
    });

    if (res.ok) {
      const data = await safeJson(res);
      if (data.success && data.other) {
        setHeaderProfile({
          nickname: data.other.nickname,
          avatar: data.other.avatar_url || data.other.avatar,
        });
        return;
      }
    }
  } catch (e) {
    // 조용히 fallback
  }

  // 2) fallback: /chat/rooms에서 roomId 매칭해서 other_* 사용
  try {
    const res = await fetch(`${API_URL}/chat/rooms`, {
      credentials: "include",
      cache: "no-store",
    });
    const data = await safeJson(res);

    if (data.success && Array.isArray(data.rooms)) {
      const r = data.rooms.find(x => String(x.room_id) === String(roomId));
      if (r) {
        setHeaderProfile({
          nickname: r.other_nickname,
          avatar: r.other_avatar,
        });
        return;
      }
    }
  } catch (e) {}

  // 그래도 못 찾으면 기본
  setHeaderProfile({ nickname: "상대방", avatar: "/assets/default_profile.png" });
}

/* ======================================================
   채팅 목록 (좌측)
====================================================== */
async function loadChatList() {
  const res = await fetch(`${API_URL}/chat/rooms`, {
    credentials: "include",
    cache: "no-store",
  });
  const data = await safeJson(res);

  chatListArea.innerHTML = "<h2>메시지</h2>";

  if (!data.success || !data.rooms?.length) return null;

  data.rooms.forEach(room => {
    const div = document.createElement("div");
    div.className = "chat-item";
    div.dataset.roomId = room.room_id;

    // 🔥 서버가 내려준 other 정보만 신뢰
    div.dataset.otherNickname = room.other_nickname || "상대방";
    div.dataset.otherAvatar   = room.other_avatar || "/assets/default_profile.png";

    div.innerHTML = `
      <div class="chat-left">
        <img src="${div.dataset.otherAvatar}">
        <div>${div.dataset.otherNickname}</div>
      </div>
      <div class="chat-unread-badge"></div>
    `;

    // ✅ 클릭 시 target 파라미터 제거 (room만 이동)
    div.onclick = () => {
      const rid = div.dataset.roomId;
      if (!rid) return;

      // UX: 클릭 즉시 헤더 반영 (로딩 체감 ↓)
      setHeaderProfile({
        nickname: div.dataset.otherNickname,
        avatar: div.dataset.otherAvatar
      });

      location.href = `/chat.html?room=${encodeURIComponent(rid)}`;
    };

    // 현재 방 하이라이트 (선택 표시)
    if (ROOM_ID && String(room.room_id) === String(ROOM_ID)) {
      div.style.background = "#eef2ff";
      div.style.border = "1px solid #c7d2fe";
    }

    chatListArea.appendChild(div);
  });

  return data.rooms[0]; // 첫 방 반환
}

/* ======================================================
   메시지 렌더링
====================================================== */
function renderMsg(msg) {
  const sender = msg.sender_id ?? msg.senderId;
  const isMe = Number(sender) === Number(CURRENT_USER?.id);

  const type = msg.message_type ?? msg.type ?? "text";
  const content = msg.message ?? msg.content ?? "";
  const fileUrl = msg.file_url ?? msg.fileUrl ?? null;

  const wrap = document.createElement("div");
  wrap.className = "msg " + (isMe ? "me" : "other");

  if (type === "image") {
    if (!fileUrl) return;
    const img = document.createElement("img");
    img.src = fileUrl;
    img.style.maxWidth = "180px";
    img.style.borderRadius = "10px";
    img.style.cursor = "pointer";
    img.onclick = () => {
      const modal = document.getElementById("imgModal");
      const modalView = document.getElementById("imgModalView");
      if (modalView) modalView.src = fileUrl;
      if (modal) modal.style.display = "flex";
    };
    wrap.appendChild(img);
  } else {
    if (!content) return;
    wrap.textContent = content;
  }

  chatBody.appendChild(wrap);
}

/* ======================================================
   메시지 로드
====================================================== */
async function loadMessages(roomId) {
  const res = await fetch(`${API_URL}/chat/messages?roomId=${encodeURIComponent(roomId)}`, {
    credentials: "include",
    cache: "no-store"
  });
  const data = await safeJson(res);

  if (!data.success) return;

  chatBody.innerHTML = "";
  (data.messages || []).forEach(renderMsg);
  scrollBottom();
}

/* ======================================================
   전송
====================================================== */
async function sendText() {
  const text = msgInput.value.trim();
  if (!text || !ROOM_ID) return;

  msgInput.value = "";

  const res = await fetch(`${API_URL}/chat/send-message`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      roomId: ROOM_ID,
      message: text,
      message_type: "text"
    })
  });

  // 실패 로그만 (UX 유지)
  try {
    const data = await safeJson(res);
    if (!data.success) console.warn("send fail:", data);
  } catch (e) {
    console.warn("send fail (non-json):", e);
  }
}

/* ======================================================
   Socket
====================================================== */
function initSocket(roomId) {
  if (socket) {
    try { socket.disconnect(); } catch {}
    socket = null;
  }

socket = io(API_URL, {
  withCredentials: true
});


  socket.on("connect", () => {
    socket.emit("chat:join", String(roomId));
  });

  socket.on("chat:message", (msg) => {
    // 다른 방 메시지 무시
    if (String(msg.roomId ?? msg.room_id) !== String(ROOM_ID)) return;

    // 내 메시지라면 중복 렌더링 방지
    const sender = msg.senderId ?? msg.sender_id;
    if (Number(sender) === Number(CURRENT_USER?.id)) return;

    renderMsg(msg);
    scrollBottom();
  });
}

/* ======================================================
   INIT (🔥 핵심)
====================================================== */
(async function init() {
  const ok = await loadMe();
  if (!ok) return;

  const firstRoom = await loadChatList();

  // room 없이 진입 → 자동으로 첫 채팅방 열기 (target 제거)
  if (!ROOM_ID && firstRoom) {
    location.replace(`/chat.html?room=${encodeURIComponent(firstRoom.room_id)}`);
    return;
  }

  if (!ROOM_ID) {
    setEmptyState("대화를 시작해보세요");
    return;
  }

  // ✅ roomId로 상대방 확정
  await loadRoomOtherProfile(ROOM_ID);

  // 메시지 + 소켓
  await loadMessages(ROOM_ID);
  initSocket(ROOM_ID);
})();

/* ======================================================
   Events
====================================================== */
sendBtn?.addEventListener("click", sendText);

msgInput?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    sendText();
  }
});

// 이미지 모달 닫기
document.getElementById("imgModal")?.addEventListener("click", () => {
  document.getElementById("imgModal").style.display = "none";
});
