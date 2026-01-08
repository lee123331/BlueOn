console.log("🔥 chat.js (FINAL) 로딩됨");

const API = "https://blueon.up.railway.app";

/* ======================================================
   URL 파라미터 (roomId 단일 기준)
====================================================== */
const params = new URLSearchParams(location.search);
const ROOM_ID = params.get("roomId");

if (!ROOM_ID) {
  alert("잘못된 접근입니다.");
  location.href = "/";
}

/* ======================================================
   DOM
====================================================== */
const chatBody        = document.getElementById("chatBody");
const msgInput        = document.getElementById("msgInput");
const sendBtn         = document.getElementById("sendBtn");
const fileBtn         = document.getElementById("fileBtn");
const fileInput       = document.getElementById("fileInput");
const headerImg       = document.getElementById("chatProfileImg");
const headerName      = document.getElementById("chatProfileName");
const typingIndicator = document.getElementById("typingIndicator");
const brandBtn        = document.getElementById("viewBrandPlanBtn");

/* ======================================================
   전역 상태
====================================================== */
let CURRENT_USER = null;
let socket       = null;
let typingTimer  = null;

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
   채팅방 정보 (상대방)
====================================================== */
async function loadContext() {
  const res = await fetch(
    `${API}/chat/room-info?roomId=${ROOM_ID}`,
    { credentials: "include" }
  );

  const data = await res.json();

  if (!data.success) {
    alert("채팅방 정보를 불러올 수 없습니다.");
    location.href = "/";
    return;
  }

  headerImg.src =
    data.avatar || "/assets/default_profile.png";
  headerName.textContent =
    data.nickname || "상대방";

  // 브랜드 설계 버튼은 필요 없으면 숨김
  if (brandBtn) brandBtn.style.display = "none";

  console.log("🧭 ROOM CONTEXT =", data);
}

/* ======================================================
   메시지 불러오기
====================================================== */
async function loadMessages() {
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
   메시지 렌더
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
    img.style.cursor = "pointer";
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
    console.log("🔌 socket connected:", socket.id);
    socket.emit("chat:join", ROOM_ID);
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
   typing emit
====================================================== */
msgInput.addEventListener("input", () => {
  if (!socket) return;

  socket.emit("chat:typing", {
    roomId: ROOM_ID,
    userId: CURRENT_USER.id,
    isTyping: true
  });

  clearTimeout(typingTimer);
  typingTimer = setTimeout(() => {
    socket.emit("chat:typing", {
      roomId: ROOM_ID,
      userId: CURRENT_USER.id,
      isTyping: false
    });
  }, 700);
});

/* ======================================================
   초기 실행
====================================================== */
(async function init() {
  await loadMe();
  await loadContext();
  await loadMessages();
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

/* ======================================================
   스크롤
====================================================== */
function scrollBottom() {
  chatBody.scrollTop = chatBody.scrollHeight;
}
