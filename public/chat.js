console.log("🔥 chat.js FINAL loaded");

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
   전역 상태
====================================================== */
let CURRENT_USER = null;
let socket = null;
let typingTimer = null;

/* ======================================================
   로그인 유저
====================================================== */
async function loadMe() {
  const res = await fetch(`${API}/auth/me`, { credentials: "include" });
  const data = await res.json();

  if (!data.success) {
    location.href = "/login.html";
    return;
  }

  CURRENT_USER = data.user;
  console.log("👤 CURRENT_USER =", CURRENT_USER);
}

/* ======================================================
   좌측 채팅방 목록
====================================================== */
async function loadChatList() {
  const res = await fetch(`${API}/chat/rooms`, {
    credentials: "include"
  });
  const data = await res.json();

  if (!data.success) return;

  chatListArea.innerHTML = "<h2>메시지</h2>";

  data.rooms.forEach(room => {
    const div = document.createElement("div");
    div.className = "chat-item";
    div.dataset.roomId = room.room_id;

    div.onclick = () => {
      location.href = `/chat.html?roomId=${room.room_id}`;
    };

    div.innerHTML = `
      <div class="chat-left">
        <img src="${room.other_avatar}">
        <div>
          <div style="font-weight:700">${room.other_nickname}</div>
          <div style="font-size:12px;color:#6b7280">
            ${room.last_msg || ""}
          </div>
        </div>
      </div>
      <div class="chat-unread-badge"
           style="display:${room.unread > 0 ? "block" : "none"}"></div>
    `;

    chatListArea.appendChild(div);
  });
}

/* ======================================================
   채팅방 상단 정보
====================================================== */
async function loadRoomInfo() {
  if (!ROOM_ID) return;

  const res = await fetch(
    `${API}/chat/room-info?roomId=${ROOM_ID}`,
    { credentials: "include" }
  );
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

  const res = await fetch(
    `${API}/chat/messages?roomId=${ROOM_ID}`,
    { credentials: "include" }
  );
  const data = await res.json();

  if (!data.success) return;

  chatBody.innerHTML = "";
  data.messages.forEach(renderMsg);
  scrollBottom();
  markRead();
}

/* ======================================================
   읽음 처리
====================================================== */
function markRead() {
  fetch(`${API}/chat/read`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ roomId: ROOM_ID })
  });

  if (socket) {
    socket.emit("chat:read", {
      roomId: ROOM_ID,
      userId: CURRENT_USER.id
    });
  }
}

/* ======================================================
   메시지 렌더링
====================================================== */
function renderMsg(msg) {
  const sender  = msg.sender_id;
  const type    = msg.message_type;
  const content = msg.message || msg.content;
  const isRead  = msg.is_read;

  if (!content) return;

  const wrap = document.createElement("div");
  wrap.className = "msg " + (sender === CURRENT_USER.id ? "me" : "other");

  if (type === "image") {
    const img = document.createElement("img");
    img.src = content;
    img.style.maxWidth = "180px";
    img.style.borderRadius = "10px";
    img.onclick = () => {
      document.getElementById("imgModalView").src = content;
      document.getElementById("imgModal").style.display = "flex";
    };
    wrap.appendChild(img);
  } else {
    wrap.textContent = content;
  }

  if (sender === CURRENT_USER.id) {
    const readEl = document.createElement("div");
    readEl.className = "read-state";
    readEl.textContent = isRead ? "읽음" : "";
    wrap.appendChild(readEl);
  }

  chatBody.appendChild(wrap);
}

/* ======================================================
   메시지 전송
====================================================== */
async function sendMessage(type, content) {
  await fetch(`${API}/chat/send-message`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      roomId: ROOM_ID,
      message_type: type,
      message: content
    })
  });
}

async function sendText() {
  const text = msgInput.value.trim();
  if (!text) return;
  msgInput.value = "";
  await sendMessage("text", text);
}

/* ======================================================
   이미지 전송
====================================================== */
fileBtn.onclick = () => fileInput.click();

fileInput.onchange = () => {
  const file = fileInput.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async () => {
    await sendMessage("image", reader.result);
    fileInput.value = "";
  };
  reader.readAsDataURL(file);
};

/* ======================================================
   socket.io
====================================================== */
function initSocket() {
  socket = io({
    withCredentials: true,
    transports: ["polling"],
    upgrade: false
  });

  socket.on("connect", () => {
    console.log("🔌 socket connected");
    if (ROOM_ID) socket.emit("chat:join", ROOM_ID);
  });

  socket.on("chat:message", msg => {
    if (msg.roomId !== ROOM_ID) return;
    if (msg.sender_id === CURRENT_USER.id) return;

    renderMsg(msg);
    scrollBottom();
    markRead();
  });

  socket.on("chat:typing", ({ roomId, userId, isTyping }) => {
    if (roomId !== ROOM_ID) return;
    if (userId === CURRENT_USER.id) return;
    typingIndicator.style.display = isTyping ? "block" : "none";
  });

  socket.on("chat:read", ({ roomId }) => {
    if (roomId !== ROOM_ID) return;
    document
      .querySelectorAll(".msg.me .read-state")
      .forEach(el => (el.textContent = "읽음"));
  });
}

/* ======================================================
   스크롤
====================================================== */
function scrollBottom() {
  chatBody.scrollTop = chatBody.scrollHeight;
}

/* ======================================================
   초기 실행
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

/* ======================================================
   이벤트
====================================================== */
sendBtn.onclick = sendText;

msgInput.addEventListener("keydown", e => {
  if (e.key === "Enter") {
    e.preventDefault();
    sendText();
  }
});

document.getElementById("imgModal").onclick = () => {
  document.getElementById("imgModal").style.display = "none";
};
