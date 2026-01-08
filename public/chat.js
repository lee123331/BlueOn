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
  const res = await fetch(`${API}/chat/rooms`, {
    credentials: "include"
  });
  const data = await res.json();
  if (!data.success) return;

  chatListArea.innerHTML = "<h2>메시지</h2>";

  data.rooms.forEach(room => {
    const roomId = String(room.roomId); // ⭐ 문자열 통일 (중요)

    const item = document.createElement("div");
    item.className = "chat-item";
    item.dataset.roomId = roomId; // ⭐ 알람 뱃지 핵심

    item.innerHTML = `
      <div class="chat-left">
        <span class="chat-unread-badge"
          style="display:${Number(room.unread) > 0 ? "block" : "none"}"></span>

        <img src="${room.avatar || "/assets/default_profile.png"}">
        <div>
          <div style="font-weight:700">
            ${room.nickname || "상대방"}
          </div>
          <div class="chat-last-msg"
               style="font-size:12px;color:#6b7280">
            ${room.last_msg || ""}
          </div>
        </div>
      </div>
    `;

    // ⭐ 클릭 시: 뱃지 숨기고 이동
    item.onclick = () => {
      hideUnreadBadge(roomId);
      location.href = `/chat.html?roomId=${roomId}`;
    };

    chatListArea.appendChild(item);
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
   메시지 렌더 (HTML/CSS 구조 완전 일치)
====================================================== */
function renderMsg(msg) {
  const senderId = Number(msg.sender_id);
  const type = msg.message_type;

  const content =
    type === "image"
      ? (msg.file_url || msg.message || msg.content)
      : (msg.message || msg.content);

  if (!content) return;

  const row = document.createElement("div");
  row.className = "msg-row " + (senderId === CURRENT_USER.id ? "me" : "other");

  const bubble = document.createElement("div");
  bubble.className = "msg-bubble";

  if (type === "image") {
    const img = document.createElement("img");
    img.src = content;
    img.onclick = () => openImageModal(content);
    bubble.appendChild(img);
  } else {
    bubble.textContent = content;
  }

  row.appendChild(bubble);

  if (senderId === CURRENT_USER.id) {
    const read = document.createElement("span");
    read.className = "read-state";
    read.textContent = msg.is_read ? "읽음" : "";
    row.appendChild(read);
  }

  chatBody.appendChild(row);
}

/* ======================================================
   메시지 전송
====================================================== */
function sendMessage(type, content) {
  renderMsg({
    sender_id: CURRENT_USER.id,
    message_type: type,
    message: type === "text" ? content : null,
    file_url: type === "image" ? content : null,
    is_read: 0
  });
  scrollBottom();

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
  });

  updateLeftLastMsg(ROOM_ID, type === "text" ? content : "📷 이미지");
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

fileInput.onchange = async () => {
  const file = fileInput.files[0];
  if (!file) return;

  const fd = new FormData();
  fd.append("image", file);

  const res = await fetch(`${API}/chat/upload-image`, {
    method: "POST",
    credentials: "include",
    body: fd
  });

  const data = await res.json();
  if (data.success && data.url) {
    sendMessage("image", data.url);
  }

  fileInput.value = "";
};

/* ======================================================
   Socket.io
====================================================== */
function initSocket() {
  socket = io({ withCredentials: true });

  socket.on("connect", () => {
    if (ROOM_ID) socket.emit("chat:join", ROOM_ID);
  });

  socket.on("chat:read", ({ roomId }) => {
  // 내가 보고 있는 방만 처리
  if (!ROOM_ID) return;
  if (String(roomId) !== String(ROOM_ID)) return;

  // 내가 보낸 메시지들의 읽음 표시를 모두 켜줌
  document
    .querySelectorAll(".msg-row.me .read-state")
    .forEach(el => {
      el.textContent = "읽음";
    });
});


socket.on("chat:message", msg => {
  const roomId = String(msg.room_id || msg.roomId);
  const senderId = Number(msg.sender_id);

  const preview =
    msg.message_type === "image"
      ? "📷 이미지"
      : (msg.message || "");

  // 좌측 마지막 메시지 갱신
  updateLeftLastMsg(roomId, preview);

  // 🔵 내가 현재 보고 있는 방
  if (ROOM_ID && roomId === String(ROOM_ID)) {
    // 내가 보낸 건 무시
    if (senderId === CURRENT_USER.id) return;

    renderMsg(msg);
    scrollBottom();

    // 즉시 읽음 처리 (서버 + 상대에게 read emit)
    markRoomAsRead(roomId);
    return;
  }

  // 🔴 다른 방에서 온 메시지 → 빨간 뱃지
  showUnreadBadge(roomId);
});

}

/* ======================================================
   읽음 처리
====================================================== */
function markRoomAsRead(roomId) {
  fetch(`${API}/chat/read`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ roomId })
  });

  hideUnreadBadge(roomId);
}

/* ======================================================
   좌측 리스트 유틸
====================================================== */
function getChatItem(roomId) {
  return document.querySelector(
    `.chat-item[data-room-id="${String(roomId)}"]`
  );
}


function showUnreadBadge(roomId) {
  const item = getChatItem(String(roomId));
  if (!item) return;
  const badge = item.querySelector(".chat-unread-badge");
  if (badge) badge.style.display = "block";
}

function hideUnreadBadge(roomId) {
  const item = getChatItem(String(roomId));
  if (!item) return;
  const badge = item.querySelector(".chat-unread-badge");
  if (badge) badge.style.display = "none";
}


function updateLeftLastMsg(roomId, text) {
  const item = getChatItem(roomId);
  if (!item) return;
  const el = item.querySelector(".chat-last-msg");
  if (el) el.textContent = text || "";
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
    markRoomAsRead(ROOM_ID);
    hideUnreadBadge(ROOM_ID);
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
