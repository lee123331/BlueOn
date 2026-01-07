console.log("🔥 chat.js 로딩됨");

const API_URL = "https://blueon.up.railway.app";

/* ======================================================
   URL 파라미터
====================================================== */
const params = new URLSearchParams(location.search);
let ROOM_ID = params.get("room");
let TARGET_ID = params.get("target");

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
    const t = await res.text();
    throw new Error("JSON 아님: " + t.slice(0, 100));
  }
  return res.json();
}

function scrollBottom() {
  chatBody.scrollTop = chatBody.scrollHeight;
}

function setEmptyState(text) {
  chatBody.innerHTML = `<div style="padding:20px;color:#6b7280;">${text}</div>`;
}

/* ======================================================
   로그인 정보
====================================================== */
async function loadMe() {
  const res = await fetch(`${API_URL}/auth/me`, { credentials: "include" });
  const data = await safeJson(res);

  if (!data.success) {
    location.href = "/login.html";
    return false;
  }

  CURRENT_USER = data.user;
  return true;
}

/* ======================================================
   채팅 목록
====================================================== */
async function loadChatList() {
  const res = await fetch(`${API_URL}/chat/rooms`, {
    credentials: "include",
    cache: "no-store"
  });
  const data = await safeJson(res);

  chatListArea.innerHTML = "<h2>메시지</h2>";

  if (!data.success || !data.rooms?.length) return null;

  data.rooms.forEach(room => {
    const div = document.createElement("div");
    div.className = "chat-item";
    div.dataset.roomId = room.room_id;
    div.dataset.targetId = room.other_id;

    div.innerHTML = `
      <div class="chat-left">
        <img src="${room.other_avatar || "/assets/default_profile.png"}">
        <div>${room.other_nickname || "상대방"}</div>
      </div>
      <div class="chat-unread-badge"></div>
    `;

    div.onclick = () => {
      location.href = `/chat.html?room=${room.room_id}&target=${room.other_id}`;
    };

    chatListArea.appendChild(div);
  });

  return data.rooms[0]; // 첫 방 반환
}

/* ======================================================
   상대 프로필
====================================================== */
async function loadTargetProfile() {
  if (!TARGET_ID) return;

  try {
    const res = await fetch(`${API_URL}/users/profile/${TARGET_ID}`, {
      credentials: "include"
    });
    const data = await safeJson(res);

    if (data.success) {
      headerImg.src = data.user.avatar_url || "/assets/default_profile.png";
      headerName.textContent = data.user.nickname || "상대방";
    }
  } catch {}
}

/* ======================================================
   메시지 렌더링
====================================================== */
function renderMsg(msg) {
  const isMe = Number(msg.sender_id ?? msg.senderId) === Number(CURRENT_USER.id);
  const type = msg.message_type;
  const wrap = document.createElement("div");
  wrap.className = "msg " + (isMe ? "me" : "other");

  if (type === "image") {
    const img = document.createElement("img");
    img.src = msg.file_url;
    img.style.maxWidth = "180px";
    img.style.borderRadius = "10px";
    wrap.appendChild(img);
  } else {
    wrap.textContent = msg.message;
  }

  chatBody.appendChild(wrap);
}

/* ======================================================
   메시지 로드
====================================================== */
async function loadMessages(roomId) {
  const res = await fetch(`${API_URL}/chat/messages?roomId=${roomId}`, {
    credentials: "include"
  });
  const data = await safeJson(res);

  if (!data.success) return;

  chatBody.innerHTML = "";
  data.messages.forEach(renderMsg);
  scrollBottom();
}

/* ======================================================
   전송
====================================================== */
async function sendText() {
  const text = msgInput.value.trim();
  if (!text || !ROOM_ID) return;

  msgInput.value = "";

  await fetch(`${API_URL}/chat/send-message`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      roomId: ROOM_ID,
      message: text,
      message_type: "text"
    })
  });
}

/* ======================================================
   Socket
====================================================== */
function initSocket(roomId) {
  socket = io(API_URL, {
    path: "/socket.io",
    transports: ["polling"],
    withCredentials: true
  });

  socket.on("connect", () => {
    socket.emit("chat:join", roomId);
  });

  socket.on("chat:message", msg => {
    if (String(msg.roomId) !== String(ROOM_ID)) return;
    if (Number(msg.senderId) === Number(CURRENT_USER.id)) return;
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

  // room 없이 진입 → 자동으로 첫 채팅방 열기
  if (!ROOM_ID && firstRoom) {
    location.replace(
      `/chat.html?room=${firstRoom.room_id}&target=${firstRoom.other_id}`
    );
    return;
  }

  if (!ROOM_ID) {
    setEmptyState("대화를 시작해보세요");
    return;
  }

  await loadTargetProfile();
  await loadMessages(ROOM_ID);
  initSocket(ROOM_ID);
})();

/* ======================================================
   Events
====================================================== */
sendBtn?.addEventListener("click", sendText);
msgInput?.addEventListener("keydown", e => {
  if (e.key === "Enter") {
    e.preventDefault();
    sendText();
  }
});
