console.log("🔥 chat.js FINAL FIX loaded");

const API = "https://blueon.up.railway.app";

/* ======================================================
   URL 파라미터
====================================================== */
const params = new URLSearchParams(location.search);
const ROOM_ID = params.get("roomId");

/* ======================================================
   DOM
====================================================== */
const chatListArea    = document.getElementById("chatList");
const chatBody        = document.getElementById("chatBody");
const msgInput        = document.getElementById("msgInput");
const sendBtn         = document.getElementById("sendBtn");
const fileBtn         = document.getElementById("fileBtn");
const fileInput       = document.getElementById("fileInput");
const headerImg       = document.getElementById("chatProfileImg");
const headerName      = document.getElementById("chatProfileName");
const typingIndicator = document.getElementById("typingIndicator");

/* ======================================================
   상태
====================================================== */
let CURRENT_USER = null;
let socket = null;

/* ======================================================
   로그인 유저
====================================================== */
async function loadMe() {
  const res = await fetch(`${API}/auth/me`, { credentials: "include" });
  const data = await res.json();
  if (!data.success) location.href = "/login.html";
  CURRENT_USER = data.user;
}

/* ======================================================
   좌측 채팅방 목록
====================================================== */
async function loadChatList() {
  const res = await fetch(`${API}/chat/rooms`, { credentials: "include" });
  const data = await res.json();
  if (!data.success) return;

  chatListArea.innerHTML = "<h2>메시지</h2>";

  data.rooms.forEach(room => {
    const div = document.createElement("div");
    div.className = "chat-item";
    div.onclick = () =>
      location.href = `/chat.html?roomId=${room.roomId}`;

    div.innerHTML = `
      <div class="chat-left">
        <img src="${room.avatar || "/assets/default_profile.png"}">
        <div>
          <div style="font-weight:700">${room.nickname || "상대방"}</div>
          <div style="font-size:12px;color:#6b7280">${room.last_msg || ""}</div>
        </div>
      </div>
    `;
    chatListArea.appendChild(div);
  });
}

/* ======================================================
   채팅방 상단
====================================================== */
async function loadRoomInfo() {
  if (!ROOM_ID) return;
  const res = await fetch(`${API}/chat/room-info?roomId=${ROOM_ID}`, {
    credentials: "include"
  });
  const data = await res.json();
  if (!data.success) return;

  headerImg.src = data.avatar || "/assets/default_profile.png";
  headerName.textContent = data.nickname || "상대방";
}

/* ======================================================
   메시지 로드
====================================================== */
async function loadMessages() {
  if (!ROOM_ID) return;
  const res = await fetch(`${API}/chat/messages?roomId=${ROOM_ID}`, {
    credentials: "include"
  });
  const data = await res.json();
  if (!data.success) return;

  chatBody.innerHTML = "";
  data.messages.forEach(renderMsg);
  scrollBottom();
}

/* ======================================================
   메시지 렌더 (🔥 핵심 수정)
====================================================== */
function renderMsg(msg) {
  const isMe = msg.sender_id === CURRENT_USER.id;
  const type = msg.message_type;
  const content = msg.content; // 🔥 통일

  if (!content) return;

  const wrap = document.createElement("div");
  wrap.className = "msg " + (isMe ? "me" : "other");

  if (type === "image") {
    const img = document.createElement("img");
    img.src = content;
    img.style.maxWidth = "180px";
    img.style.borderRadius = "10px";
    img.style.cursor = "pointer";
    img.onclick = () => {
      document.getElementById("imgModalView").src = content;
      document.getElementById("imgModal").style.display = "flex";
    };
    wrap.appendChild(img);
  } else {
    wrap.textContent = content;
  }

  chatBody.appendChild(wrap);
}

/* ======================================================
   메시지 전송 (🔥 즉시 렌더)
====================================================== */
function sendMessage(type, content) {
  // ✅ 1. 즉시 렌더
  renderMsg({
    sender_id: CURRENT_USER.id,
    message_type: type,
    content
  });
  scrollBottom();

  // ✅ 2. 서버 전송 (백그라운드)
  fetch(`${API}/chat/send-message`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      roomId: ROOM_ID,
      message_type: type,
      content
    })
  }).catch(err => {
    console.error("❌ send-message fail", err);
  });
}

function sendText() {
  const text = msgInput.value.trim();
  if (!text) return;
  msgInput.value = "";
  sendMessage("text", text);
}

/* ======================================================
   이미지 전송
====================================================== */
fileBtn.onclick = () => fileInput.click();

fileInput.onchange = () => {
  const file = fileInput.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    sendMessage("image", reader.result);
    fileInput.value = "";
  };
  reader.readAsDataURL(file);
};

/* ======================================================
   socket.io
====================================================== */
function initSocket() {
  socket = io({ withCredentials: true });

  socket.on("connect", () => {
    socket.emit("chat:join", ROOM_ID);
  });

  socket.on("chat:message", msg => {
    if (String(msg.roomId || msg.room_id) !== String(ROOM_ID)) return;
    if (msg.sender_id === CURRENT_USER.id) return;
    renderMsg(msg);
    scrollBottom();
  });
}

/* ======================================================
   실행
====================================================== */
(async function init() {
  await loadMe();
  await loadChatList();
  if (ROOM_ID) {
    await loadRoomInfo();
    await loadMessages();
  }
  initSocket();
})();

sendBtn.onclick = sendText;
msgInput.addEventListener("keydown", e => {
  if (e.key === "Enter") {
    e.preventDefault();
    sendText();
  }
});

function scrollBottom() {
  chatBody.scrollTop = chatBody.scrollHeight;
}
