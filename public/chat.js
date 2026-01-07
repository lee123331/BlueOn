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

function setHeader(nickname, avatar) {
  headerName.textContent = nickname || "상대방";
  headerImg.src = avatar || "/assets/default_profile.png";
}

function setEmpty(text) {
  chatBody.innerHTML = `<div style="padding:20px;color:#6b7280;">${text}</div>`;
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
   채팅 목록 (좌측)
====================================================== */
async function loadChatList() {
  const res = await fetch(`${API_URL}/chat/rooms`, {
    credentials: "include",
    cache: "no-store"
  });
  const data = await safeJson(res);

  chatListArea.innerHTML = "<h2>메시지</h2>";
  if (!data.success || !Array.isArray(data.rooms)) return null;

  data.rooms.forEach(room => {
    const div = document.createElement("div");
    div.className = "chat-item";
    div.dataset.roomId = room.room_id;
    div.dataset.nickname = room.other_nickname || "상대방";
    div.dataset.avatar = room.other_avatar || "/assets/default_profile.png";

    div.innerHTML = `
      <div class="chat-left">
        <img src="${div.dataset.avatar}">
        <div>${div.dataset.nickname}</div>
      </div>
      <div class="chat-unread-badge"></div>
    `;

    div.onclick = () => {
      location.href = `/chat.html?room=${room.room_id}`;
    };

    if (ROOM_ID && String(room.room_id) === String(ROOM_ID)) {
      div.style.background = "#eef2ff";
    }

    chatListArea.appendChild(div);
  });

  return data.rooms[0] || null;
}

/* ======================================================
   헤더 프로필 (room 기준)
====================================================== */
async function setHeaderByRoomId(roomId) {
  const item = document.querySelector(`.chat-item[data-room-id='${roomId}']`);

  if (item) {
    setHeader(item.dataset.nickname, item.dataset.avatar);
    return;
  }

  try {
    const res = await fetch(`${API_URL}/chat/rooms`, {
      credentials: "include",
      cache: "no-store"
    });
    const data = await res.json();

    if (data.success) {
      const r = data.rooms.find(x => String(x.room_id) === String(roomId));
      if (r) {
        setHeader(r.other_nickname, r.other_avatar);
        return;
      }
    }
  } catch {}

  setHeader("상대방", "/assets/default_profile.png");
}

/* ======================================================
   메시지 렌더
====================================================== */
function renderMsg(msg) {
  const sender = msg.sender_id ?? msg.senderId;
  const isMe = Number(sender) === Number(CURRENT_USER.id);

  const wrap = document.createElement("div");
  wrap.className = "msg " + (isMe ? "me" : "other");
  wrap.dataset.messageId = msg.id || msg.message_id;

  if (msg.message_type === "image") {
    const img = document.createElement("img");
    img.src = msg.file_url;
    img.style.maxWidth = "180px";
    img.style.borderRadius = "10px";
    wrap.appendChild(img);
  } else {
    wrap.textContent = msg.message;
  }

  // 🔥 삭제 버튼 (내 메시지)
  if (isMe && wrap.dataset.messageId) {
    const del = document.createElement("button");
    del.className = "msg-delete-btn";
    del.textContent = "삭제";
    del.onclick = () => deleteMessage(wrap.dataset.messageId);
    wrap.appendChild(del);

    const read = document.createElement("div");
    read.className = "read-state";
    wrap.appendChild(read);
  }

  chatBody.appendChild(wrap);
}

/* ======================================================
   메시지 로드 + 읽음
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

  markRead(roomId);
}

/* ======================================================
   읽음 처리
====================================================== */
function markRead(roomId) {
  fetch(`${API_URL}/chat/read`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ roomId })
  }).catch(() => {});

  socket?.emit("chat:read", {
    roomId,
    userId: CURRENT_USER.id
  });

  window.refreshHeaderBadge?.();
}

/* ======================================================
   메시지 전송
====================================================== */
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

/* ======================================================
   🔥 메시지 삭제 (DB + socket)
====================================================== */
async function deleteMessage(messageId) {
  if (!messageId) return;

  await fetch(`${API_URL}/chat/delete`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messageId })
  });

  socket?.emit("chat:delete", {
    roomId: ROOM_ID,
    messageId
  });

  document
    .querySelector(`.msg[data-message-id='${messageId}']`)
    ?.remove();
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
    document
      .querySelectorAll(".msg.me .read-state")
      .forEach(el => el.textContent = "읽음");
  });

  socket.on("chat:delete", ({ messageId }) => {
    document
      .querySelector(`.msg[data-message-id='${messageId}']`)
      ?.remove();
  });
}

/* ======================================================
   INIT
====================================================== */
(async function init() {
  const ok = await loadMe();
  if (!ok) return;

  const firstRoom = await loadChatList();

  if (!ROOM_ID && firstRoom) {
    location.replace(`/chat.html?room=${firstRoom.room_id}`);
    return;
  }

  if (!ROOM_ID) {
    setEmpty("대화를 시작해보세요");
    return;
  }

  initSocket(ROOM_ID);
  await setHeaderByRoomId(ROOM_ID);
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
