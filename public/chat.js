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
   좌측 채팅 목록 (중복 제거)
====================================================== */
async function loadChatList() {
  const res = await fetch(`${API_URL}/chat/rooms`, {
    credentials: "include",
    cache: "no-store"
  });
  const data = await safeJson(res);

  chatListArea.innerHTML = "<h2>메시지</h2>";
  if (!data.success || !Array.isArray(data.rooms)) return null;

  const seenRoom = new Set();
  const unique = [];

  for (const r of data.rooms) {
    const key = String(r.room_id);
    if (seenRoom.has(key)) continue;
    seenRoom.add(key);
    unique.push(r);
  }

  unique.forEach(room => {
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
      setHeader(div.dataset.nickname, div.dataset.avatar);
      location.href = `/chat.html?room=${room.room_id}`;
    };

    if (ROOM_ID && String(room.room_id) === String(ROOM_ID)) {
      div.style.background = "#eef2ff";
    }

    chatListArea.appendChild(div);
  });

  return unique[0] || null;
}

/* ======================================================
   room 기준 상대 프로필
====================================================== */
async function loadRoomProfile(roomId) {
  try {
    const res = await fetch(`${API_URL}/chat/room-info?roomId=${roomId}`, {
      credentials: "include",
      cache: "no-store"
    });
    if (!res.ok) throw 0;

    const data = await safeJson(res);
    if (data.success && data.other) {
      setHeader(
        data.other.nickname,
        data.other.avatar_url || data.other.avatar
      );
      return;
    }
  } catch {}

  // fallback
  const el = document.querySelector(`.chat-item[data-room-id='${roomId}']`);
  if (el) setHeader(el.dataset.nickname, el.dataset.avatar);
}

/* ======================================================
   메시지 렌더
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
    img.onclick = () => {
      document.getElementById("imgModalView").src = img.src;
      document.getElementById("imgModal").style.display = "flex";
    };
    wrap.appendChild(img);
  } else {
    wrap.textContent = msg.message;
  }

  chatBody.appendChild(wrap);
}

/* ======================================================
   메시지 로드 + 읽음 처리
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

  // ✅🔥 여기 추가 (읽음 처리)
  fetch(`${API_URL}/chat/read`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ roomId })
  });

  // ✅ 상대방에게 "읽음" 소켓 알림
  socket?.emit("chat:read", {
    roomId,
    userId: CURRENT_USER.id
  });
}

/* ======================================================
   🔥 읽음 처리 (DB + socket)
====================================================== */
async function markRead(roomId) {
  try {
    await fetch(`${API_URL}/chat/read`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roomId })
    });

    if (socket) {
      socket.emit("chat:read", {
        roomId,
        userId: CURRENT_USER.id
      });
    }
  } catch (e) {
    console.warn("markRead fail", e);
  }
}

/* ======================================================
   전송 (즉시 렌더)
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
   이미지 업로드
====================================================== */
fileBtn?.addEventListener("click", () => fileInput.click());

fileInput?.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  if (!file || !ROOM_ID) return;

  const form = new FormData();
  form.append("file", file);

  const uploadRes = await fetch(`${API_URL}/chat/upload`, {
    method: "POST",
    credentials: "include",
    body: form
  });
  const uploadData = await uploadRes.json();
  if (!uploadData.success) return;

  renderMsg({
    senderId: CURRENT_USER.id,
    message_type: "image",
    file_url: uploadData.file_url
  });
  scrollBottom();

  fetch(`${API_URL}/chat/send-message`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      roomId: ROOM_ID,
      message_type: "image",
      file_url: uploadData.file_url
    })
  });
});

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
  });

  socket.on("chat:read", ({ roomId, userId }) => {
  if (String(roomId) !== String(ROOM_ID)) return;

  // 🔥 내가 보낸 메시지 중 읽음 표시
  const myMessages = chatBody.querySelectorAll(".msg.me");

  myMessages.forEach(msg => {
    let readEl = msg.querySelector(".read-state");

    if (!readEl) {
      readEl = document.createElement("div");
      readEl.className = "read-state";
      msg.appendChild(readEl);
    }

    readEl.textContent = "읽음";
  });
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

  await loadRoomProfile(ROOM_ID);
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
