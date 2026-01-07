console.log("🔥 chat.js 로딩됨");

/* ======================================================
   API URL (중복 선언 안전 처리)
====================================================== */
const API_URL =
  window.API_URL ||
  "https://blueon.up.railway.app";

/* ======================================================
   URL 파라미터
====================================================== */
const params = new URLSearchParams(location.search);
const ROOM_ID = params.get("room");
const TARGET_ID = params.get("target");
const IS_ROOM_MODE = !!(ROOM_ID && TARGET_ID);

console.log("🔍 ROOM_ID =", ROOM_ID);
console.log("🔍 TARGET_ID =", TARGET_ID);

/* ======================================================
   DOM 요소
====================================================== */
const chatBody        = document.getElementById("chatBody");
const msgInput        = document.getElementById("msgInput");
const sendBtn         = document.getElementById("sendBtn");
const fileBtn         = document.getElementById("fileBtn");
const fileInput       = document.getElementById("fileInput");
const chatListArea    = document.getElementById("chatList");
const headerImg       = document.getElementById("chatProfileImg");
const headerName      = document.getElementById("chatProfileName");
const typingIndicator = document.getElementById("typingIndicator");

let CURRENT_USER = null;
let typingTimer  = null;
let socket       = null;

/* ======================================================
   전문가 여부
====================================================== */
async function loadIsExpert(userId) {
  try {
    const res = await fetch(`${API_URL}/expert/profile/${userId}`, {
      credentials: "include"
    });
    const data = await res.json();
    return data.success === true;
  } catch {
    return false;
  }
}

/* ======================================================
   로그인 정보
====================================================== */
async function loadMe() {
  const res = await fetch(`${API_URL}/auth/me`, {
    credentials: "include"
  });

  const data = await res.json();
  if (!data.success) {
    location.href = "/login.html";
    return;
  }

  CURRENT_USER = data.user;
  CURRENT_USER.isExpert = await loadIsExpert(CURRENT_USER.id);

  console.log("🟢 CURRENT_USER =", CURRENT_USER);
}

/* ======================================================
   상대 프로필
====================================================== */
async function loadTargetProfile() {
  if (!TARGET_ID) return;

  let res = await fetch(`${API_URL}/expert/profile/${TARGET_ID}`, {
    credentials: "include"
  });
  let data = await res.json();

  if (data.success) {
    headerImg.src = data.profile.avatar_url || "/assets/default_profile.png";
    headerName.textContent = data.profile.nickname || "전문가";
    return;
  }

  res = await fetch(`${API_URL}/users/profile/${TARGET_ID}`, {
    credentials: "include"
  });
  data = await res.json();

  if (data.success) {
    headerImg.src = data.user.avatar || "/assets/default_profile.png";
    headerName.textContent =
      data.user.nickname || data.user.name || "사용자";
  }
}

/* ======================================================
   읽음 처리
====================================================== */
async function markRead() {
  if (!ROOM_ID) return;

  await fetch(`${API_URL}/chat/read`, {
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
   메시지 로드
====================================================== */
async function loadMessages() {
  if (!ROOM_ID) return;

  const res = await fetch(`${API_URL}/chat/messages?roomId=${ROOM_ID}`, {
    credentials: "include"
  });
  const data = await res.json();

  if (data.success) {
    chatBody.innerHTML = "";
    data.messages.forEach(renderMsg);
    scrollBottom();
    markRead();
  }
}

/* ======================================================
   메시지 렌더
====================================================== */
function renderMsg(msg) {
  const sender  = msg.senderId ?? msg.sender_id;
  const type    = msg.message_type ?? msg.type;
  const content = msg.message ?? msg.content;
  const isRead  = msg.is_read ?? false;

  if (!content) return;

  const wrap = document.createElement("div");
  wrap.className = "msg " + (sender === CURRENT_USER.id ? "me" : "other");
  wrap.dataset.messageId = msg.message_id || msg.id;

  if (sender === CURRENT_USER.id) {
    const del = document.createElement("button");
    del.className = "msg-delete-btn";
    del.textContent = "삭제";
    del.onclick = () => deleteMessage(wrap.dataset.messageId);
    wrap.appendChild(del);
  }

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
    const box = document.createElement("div");
    box.textContent = content;
    wrap.appendChild(box);
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
   메시지 삭제
====================================================== */
async function deleteMessage(messageId) {
  document
    .querySelector(`[data-message-id='${messageId}']`)
    ?.remove();

  const res = await fetch(`${API_URL}/chat/message/${messageId}`, {
    method: "DELETE",
    credentials: "include"
  });
  const data = await res.json();

  if (data.success && socket) {
    socket.emit("chat:delete", { roomId: ROOM_ID, messageId });
  }
}

/* ======================================================
   텍스트 전송
====================================================== */
async function sendText() {
  const text = msgInput.value.trim();
  if (!text) return;

  msgInput.value = "";

  await fetch(`${API_URL}/chat/send-message`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      roomId: ROOM_ID,
      senderId: CURRENT_USER.id,
      message: text,
      message_type: "text"
    })
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

  if (typeof io === "undefined") {
    console.error("❌ socket.io 로드 실패");
    return;
  }

  socket = io({
    transports: ["websocket"],   // 🔥 polling 차단 → Mixed Content 방지
    withCredentials: true,
    auth: { userId: CURRENT_USER.id }
  });

  socket.on("connect", () => {
    console.log("🟦 소켓 연결:", socket.id);
    if (IS_ROOM_MODE) socket.emit("chat:join", ROOM_ID);
  });

  socket.on("chat:message", msg => {
    if (msg.senderId === CURRENT_USER.id) return;
    if (ROOM_ID == msg.roomId) {
      renderMsg(msg);
      scrollBottom();
      markRead();
    }
  });

  socket.on("chat:typing", ({ roomId, userId, isTyping }) => {
    if (ROOM_ID != roomId || userId === CURRENT_USER.id) return;
    typingIndicator.style.display = isTyping ? "block" : "none";
  });

  socket.on("chat:read", ({ roomId }) => {
    if (ROOM_ID != roomId) return;
    document
      .querySelectorAll(".msg.me .read-state")
      .forEach(el => (el.textContent = "읽음"));
  });

  if (IS_ROOM_MODE) {
    await loadTargetProfile();
    await loadMessages();
  }
})();

/* ======================================================
   이벤트
====================================================== */
sendBtn.onclick = sendText;

msgInput.onkeydown = e => {
  if (e.key === "Enter") {
    e.preventDefault();
    sendText();
  }
};

document.getElementById("imgModal").onclick = () => {
  document.getElementById("imgModal").style.display = "none";
};
