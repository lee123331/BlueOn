console.log("🔥 chat.js FINAL COMPLETE loaded");

const API = "https://blueon.up.railway.app";

/* ======================================================
   URL 파라미터
====================================================== */
const params = new URLSearchParams(location.search);
const ROOM_ID = params.get("roomId");

/* ======================================================
   DOM
====================================================== */
const chatListArea = document.getElementById("chatList");
const chatBody     = document.getElementById("chatBody");
const msgInput     = document.getElementById("msgInput");
const sendBtn      = document.getElementById("sendBtn");
const fileBtn      = document.getElementById("fileBtn");
const fileInput    = document.getElementById("fileInput");

const headerImg  = document.getElementById("chatProfileImg");
const headerName = document.getElementById("chatProfileName");

/* 이미지 모달 */
const imgModal = document.getElementById("imgModal");
const imgView  = document.getElementById("imgModalView");

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
    div.onclick = () => {
      location.href = `/chat.html?roomId=${room.roomId}`;
    };

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
   채팅방 상단 정보
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
   메시지 로드 (DB)
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
   메시지 렌더
====================================================== */
function renderMsg(msg) {
  const senderId = Number(msg.sender_id);
  const type = msg.message_type;

  const content =
    type === "image"
      ? (msg.file_url || msg.message || msg.content)
      : (msg.message || msg.content);

  if (!content) return;

  const wrap = document.createElement("div");
  wrap.className = "msg " + (senderId === CURRENT_USER.id ? "me" : "other");

  if (type === "image") {
    const img = document.createElement("img");
    img.src = content;
    img.style.maxWidth = "180px";
    img.style.borderRadius = "10px";
    img.style.cursor = "pointer";

    img.onclick = () => openImageModal(content);
    wrap.appendChild(img);
  } else {
    wrap.textContent = content;
  }

  chatBody.appendChild(wrap);
}

/* ======================================================
   메시지 전송 (텍스트/이미지 공용)
====================================================== */
function sendMessage(type, content) {
  // 🔥 즉시 렌더
  renderMsg({
    sender_id: CURRENT_USER.id,
    message_type: type,
    message: type === "text" ? content : null,
    file_url: type === "image" ? content : null
  });
  scrollBottom();

  // 🔥 서버 저장
  fetch(`${API}/chat/send-message`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      roomId: ROOM_ID,
      message_type: type,
      message: type === "text" ? content : null,
      file_url: type === "image" ? content : null
    })
  }).catch(err => {
    console.error("❌ send-message error", err);
  });
}

function sendText() {
  const text = msgInput.value.trim();
  if (!text) return;
  msgInput.value = "";
  sendMessage("text", text);
}

/* ======================================================
   이미지 전송 (🔥 핵심)
====================================================== */
fileBtn.onclick = () => fileInput.click();

fileInput.onchange = async () => {
  const file = fileInput.files[0];
  if (!file) return;

  try {
    const fd = new FormData();
    fd.append("image", file);

    // 1️⃣ 업로드
    const upRes = await fetch(`${API}/chat/upload-image`, {
      method: "POST",
      credentials: "include",
      body: fd
    });

    const upData = await upRes.json();
    if (!upData.success || !upData.url) {
      console.error("❌ image upload fail", upData);
      return;
    }

    // 2️⃣ URL로 메시지 전송
    sendMessage("image", upData.url);

  } catch (err) {
    console.error("❌ image send error", err);
  } finally {
    fileInput.value = "";
  }
};

/* ======================================================
   Socket.io
====================================================== */
function initSocket() {
  socket = io({ withCredentials: true });

  socket.on("connect", () => {
    socket.emit("chat:join", ROOM_ID);
    console.log("🔌 socket connected");
  });

  socket.on("chat:message", msg => {
    if (String(msg.room_id || msg.roomId) !== String(ROOM_ID)) return;
    if (msg.sender_id === CURRENT_USER.id) return;
    renderMsg(msg);
    scrollBottom();
  });
}

/* ======================================================
   이미지 모달
====================================================== */
function openImageModal(src) {
  imgView.src = src;
  imgModal.style.display = "flex";
}

if (imgModal) {
  imgModal.onclick = () => {
    imgModal.style.display = "none";
    imgView.src = "";
  };
}

/* ======================================================
   유틸
====================================================== */
function scrollBottom() {
  chatBody.scrollTop = chatBody.scrollHeight;
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
