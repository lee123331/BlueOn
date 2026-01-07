console.log("🔥 chat.js 로딩됨");

const API_URL = "https://blueon.up.railway.app";

/* ======================================================
   URL 파라미터
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
    throw new Error(`JSON 아님 (${res.status}): ${t.slice(0, 120)}`);
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

function setEmpty() {
  setHeader("채팅", "/assets/default_profile.png");
  chatBody.innerHTML =
    `<div style="padding:20px;color:#6b7280;">대화를 선택해주세요</div>`;
}

/* ======================================================
   로그인 유저
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

  data.rooms.forEach(r => {
    const div = document.createElement("div");
    div.className = "chat-item";
    div.innerHTML = `
      <div class="chat-left">
        <img src="${r.other_avatar || "/assets/default_profile.png"}">
        <div>${r.other_nickname || "상대방"}</div>
      </div>
    `;

    if (ROOM_ID && String(r.room_id) === String(ROOM_ID)) {
      div.style.background = "#eef2ff";
    }

    div.onclick = () => {
      location.href = `/chat.html?room=${r.room_id}`;
    };

    chatListArea.appendChild(div);
  });

  return data.rooms[0];
}

/* ======================================================
   roomId 기준 상대 프로필
====================================================== */
async function loadHeaderByRoom(roomId) {
  const res = await fetch(`${API_URL}/chat/rooms`, {
    credentials: "include",
    cache: "no-store",
  });
  const data = await safeJson(res);

  if (!data.success) return;
  const room = data.rooms.find(r => String(r.room_id) === String(roomId));
  if (!room) return;

  setHeader(room.other_nickname, room.other_avatar);
}

/* ======================================================
   메시지 렌더
====================================================== */
function renderMsg(msg) {
  const sender = msg.sender_id ?? msg.senderId;
  const isMe = Number(sender) === Number(CURRENT_USER.id);

  const wrap = document.createElement("div");
  wrap.className = "msg " + (isMe ? "me" : "other");

  if (msg.message_type === "image" && msg.file_url) {
    const img = document.createElement("img");
    img.src = msg.file_url;
    img.style.maxWidth = "180px";
    img.style.borderRadius = "10px";
    wrap.appendChild(img);
  } else {
    wrap.textContent = msg.message || msg.content;
  }

  chatBody.appendChild(wrap);
}

/* ======================================================
   메시지 로드
====================================================== */
async function loadMessages(roomId) {
  const res = await fetch(
    `${API_URL}/chat/messages?roomId=${encodeURIComponent(roomId)}`,
    { credentials: "include", cache: "no-store" }
  );
  const data = await safeJson(res);
  if (!data.success) return;

  chatBody.innerHTML = "";
  data.messages.forEach(renderMsg);
  scrollBottom();
}

/* ======================================================
   텍스트 전송 (🔥 즉시 렌더)
====================================================== */
async function sendText() {
  const text = msgInput.value.trim();
  if (!text || !ROOM_ID) return;
  msgInput.value = "";

  // ✅ 즉시 렌더
  renderMsg({
    sender_id: CURRENT_USER.id,
    message: text,
    message_type: "text",
  });
  scrollBottom();

  // 서버 전송
  await fetch(`${API_URL}/chat/send-message`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      roomId: ROOM_ID,
      message: text,
      message_type: "text",
    }),
  });
}

/* ======================================================
   📸 이미지 전송
====================================================== */
fileBtn?.addEventListener("click", () => fileInput.click());

fileInput?.addEventListener("change", async () => {
  const file = fileInput.files[0];
  if (!file || !ROOM_ID) return;

  const fd = new FormData();
  fd.append("file", file);

  // 1️⃣ 업로드
  const upRes = await fetch(`${API_URL}/chat/upload`, {
    method: "POST",
    credentials: "include",
    body: fd,
  });
  const up = await safeJson(upRes);
  if (!up.success) return;

  // 2️⃣ 즉시 렌더
  renderMsg({
    sender_id: CURRENT_USER.id,
    message_type: "image",
    file_url: up.file_url,
  });
  scrollBottom();

  // 3️⃣ 서버 전송
  await fetch(`${API_URL}/chat/send-message`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      roomId: ROOM_ID,
      message_type: "image",
      file_url: up.file_url,
    }),
  });

  fileInput.value = "";
});

/* ======================================================
   Socket
====================================================== */
function initSocket(roomId) {
  if (socket) socket.disconnect();

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
}

/* ======================================================
   INIT
====================================================== */
(async function init() {
  const ok = await loadMe();
  if (!ok) return;

  const first = await loadChatList();
  if (!ROOM_ID && first) {
    location.replace(`/chat.html?room=${first.room_id}`);
    return;
  }

  if (!ROOM_ID) {
    setEmpty();
    return;
  }

  await loadHeaderByRoom(ROOM_ID);
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
