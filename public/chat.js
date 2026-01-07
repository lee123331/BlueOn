console.log("🔥 chat.js loaded");

const API_URL = "https://blueon.up.railway.app";

/* ======================================================
   URL
====================================================== */
const params = new URLSearchParams(location.search);
let ROOM_ID = params.get("room");

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
    throw new Error(`JSON 아님: ${t.slice(0,120)}`);
  }
  return res.json();
}

function scrollBottom() {
  chatBody.scrollTop = chatBody.scrollHeight;
}

/* ======================================================
   로그인
====================================================== */
async function loadMe() {
  const res = await fetch(`${API_URL}/auth/me`, {
    credentials: "include",
    cache: "no-store"
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
   메시지 렌더 (읽음 DOM 포함)
====================================================== */
function renderMsg(msg) {
  const sender = msg.sender_id ?? msg.senderId;
  const isMe = Number(sender) === Number(CURRENT_USER.id);

  const wrap = document.createElement("div");
  wrap.className = "msg " + (isMe ? "me" : "other");

  if (msg.message_type === "image") {
    const img = document.createElement("img");
    img.src = msg.file_url;
    img.style.maxWidth = "180px";
    img.style.borderRadius = "10px";
    wrap.appendChild(img);
  } else {
    wrap.textContent = msg.message;
  }

  // ✅ 처음부터 read-state 생성
  if (isMe) {
    const read = document.createElement("div");
    read.className = "read-state";
    read.textContent = "";
    wrap.appendChild(read);
  }

  chatBody.appendChild(wrap);
}

/* ======================================================
   읽음 처리 (DB + socket)
====================================================== */
async function markRead(roomId) {
  if (!socket || !roomId) return;

  fetch(`${API_URL}/chat/read`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ roomId })
  }).catch(() => {});

  socket.emit("chat:read", {
    roomId,
    userId: CURRENT_USER.id
  });

  // 헤더 배지 갱신
  window.refreshHeaderBadge?.();
}

/* ======================================================
   메시지 로드
====================================================== */
async function loadMessages(roomId) {
  const res = await fetch(`${API_URL}/chat/messages?roomId=${roomId}`, {
    credentials: "include",
    cache: "no-store"
  });
  const data = await safeJson(res);
  if (!data.success) return;

  chatBody.innerHTML = "";
  data.messages.forEach(renderMsg);
  scrollBottom();

  // ✅ 소켓 연결된 후 읽음 처리
  markRead(roomId);
}

/* ======================================================
   Socket
====================================================== */
function initSocket(roomId) {
  socket = io(API_URL, { withCredentials: true });

  socket.on("connect", () => {
    socket.emit("chat:join", String(roomId));
  });

  socket.on("chat:message", msg => {
    if (String(msg.roomId) !== String(ROOM_ID)) return;
    if (Number(msg.senderId) === Number(CURRENT_USER.id)) return;
    renderMsg(msg);
    scrollBottom();
    markRead(ROOM_ID);
  });

  socket.on("chat:read", ({ roomId }) => {
    if (String(roomId) !== String(ROOM_ID)) return;

    document.querySelectorAll(".msg.me .read-state")
      .forEach(el => el.textContent = "읽음");
  });
}

/* ======================================================
   INIT
====================================================== */
(async function init() {
  const ok = await loadMe();
  if (!ok) return;

  initSocket(ROOM_ID);
  await loadMessages(ROOM_ID);
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

async function sendText() {
  const text = msgInput.value.trim();
  if (!text || !ROOM_ID) return;

  msgInput.value = "";

  renderMsg({
    senderId: CURRENT_USER.id,
    message: text,
    message_type: "text"
  });
  scrollBottom();

  fetch(`${API_URL}/chat/send-message`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      roomId: ROOM_ID,
      message: text,
      message_type: "text"
    })
  }).catch(() => {});
}
