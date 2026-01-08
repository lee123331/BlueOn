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
const chatBody = document.getElementById("chatBody");
const msgInput = document.getElementById("msgInput");
const sendBtn = document.getElementById("sendBtn");
const fileBtn = document.getElementById("fileBtn");
const fileInput = document.getElementById("fileInput");

const headerImg = document.getElementById("chatProfileImg");
const headerName = document.getElementById("chatProfileName");

const imgModal = document.getElementById("imgModal");
const imgView = document.getElementById("imgModalView");

/* ======================================================
   상태
====================================================== */
let CURRENT_USER = null;
let socket = null;
const PENDING_CLIENT_IDS = new Set();

/* ======================================================
   유틸
====================================================== */
const safeStr = v => (v == null ? "" : String(v));
const scrollBottom = () => chatBody && (chatBody.scrollTop = chatBody.scrollHeight);
const genClientMsgId = () =>
  `c_${Date.now()}_${Math.random().toString(16).slice(2)}`;

/* ======================================================
   로그인
====================================================== */
async function loadMe() {
  const res = await fetch(`${API}/auth/me`, { credentials: "include" });
  const data = await res.json();
  if (!data.success) location.href = "/login.html";
  CURRENT_USER = data.user;
}

/* ======================================================
   좌측 채팅 리스트
====================================================== */
async function loadChatList() {
  if (!chatListArea) return;

  const res = await fetch(`${API}/chat/rooms`, { credentials: "include" });
  const data = await res.json();
  if (!data.success) return;

  chatListArea.innerHTML = "<h2>메시지</h2>";

  (data.rooms || []).forEach(room => {
    if (!room.roomId) return;

    const item = document.createElement("div");
    item.className = "chat-item";
    item.dataset.roomId = room.roomId;

    item.innerHTML = `
      <div class="chat-left">
        <span class="chat-unread-badge" style="display:${Number(room.unread) > 0 ? "block" : "none"}"></span>
        <img src="${room.avatar || "/assets/default_profile.png"}">
        <div class="chat-texts">
          <div class="chat-name">${room.nickname || "상대방"}</div>
          <div class="chat-last">${room.last_msg || ""}</div>
        </div>
      </div>
    `;

    item.onclick = () => {
      location.href = `/chat.html?roomId=${room.roomId}`;
    };

    chatListArea.appendChild(item);
  });
}

/* ======================================================
   채팅방 상단 정보
====================================================== */
async function loadRoomInfo() {
  if (!ROOM_ID) return;

  const res = await fetch(
    `${API}/chat/room-info?roomId=${encodeURIComponent(ROOM_ID)}`,
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
  if (!ROOM_ID || !chatBody) return;

  const res = await fetch(
    `${API}/chat/messages?roomId=${encodeURIComponent(ROOM_ID)}`,
    { credentials: "include" }
  );
  const data = await res.json();
  if (!data.success) return;

  chatBody.innerHTML = "";
  (data.messages || []).forEach(renderMsg);
  scrollBottom();
}

/* ======================================================
   메시지 렌더
====================================================== */
function renderMsg(msg) {
  if (!chatBody || !CURRENT_USER) return;

  const isMe = Number(msg.sender_id) === Number(CURRENT_USER.id);
  const type = msg.message_type || "text";
  const content = type === "image" ? msg.file_url : msg.message;
  if (!content) return;

  // ✅ pending 메시지 → 서버 메시지로 치환
  if (msg.clientMsgId) {
    const pending = document.querySelector(
      `.msg-row[data-client-msg-id="${msg.clientMsgId}"]`
    );
    if (pending) {
      pending.dataset.messageId = msg.id;
      PENDING_CLIENT_IDS.delete(msg.clientMsgId);
      return;
    }
  }

  const row = document.createElement("div");
  row.className = `msg-row ${isMe ? "me" : "other"}`;
  if (msg.id) row.dataset.messageId = msg.id;
  if (msg.clientMsgId) row.dataset.clientMsgId = msg.clientMsgId;

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
  socket.on("chat:read", ({ roomId }) => {
  if (safeStr(roomId) !== safeStr(ROOM_ID)) return;

  document
    .querySelectorAll(".msg-row.me .read-state")
    .forEach(el => {
      el.textContent = "읽음";
    });
});

  chatBody.appendChild(row);
}

/* ======================================================
   메시지 전송 (중복 방지 완성판)
====================================================== */
async function sendMessage(type, content) {
  if (!ROOM_ID || !CURRENT_USER || !content) return;

  const clientMsgId = genClientMsgId();
  PENDING_CLIENT_IDS.add(clientMsgId);

  // 1️⃣ UI에 즉시 표시
  renderMsg({
    id: `pending_${clientMsgId}`,
    clientMsgId,
    sender_id: CURRENT_USER.id,
    message_type: type,
    message: type === "text" ? content : null,
    file_url: type === "image" ? content : null,
    is_read: 0
  });

  scrollBottom();

  // 2️⃣ 서버 전송
  await fetch(`${API}/chat/send-message`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      roomId: ROOM_ID,
      message_type: type,
      message: type === "text" ? content : null,
      file_url: type === "image" ? content : null,
      clientMsgId
    })
  });
}
function markRoomAsRead(roomId) {
  if (!roomId) return;

  fetch(`${API}/chat/read`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ roomId }),
  }).catch(() => {});
}

/* ======================================================
   Socket.io (🔥 중복 완전 차단)
====================================================== */
function initSocket() {
  socket = io(API, { withCredentials: true });

  socket.on("connect", () => {
    if (ROOM_ID) socket.emit("chat:join", ROOM_ID);
  });

  socket.on("chat:message", msg => {
    // ✅ 다른 방 메시지 무시
    if (safeStr(msg.room_id) !== safeStr(ROOM_ID)) return;

    // ✅ 내가 보낸 메시지는 socket에서 무시
    if (Number(msg.sender_id) === Number(CURRENT_USER.id)) return;

    // ✅ pending clientMsgId 중복 차단
    if (msg.clientMsgId && PENDING_CLIENT_IDS.has(msg.clientMsgId)) return;

    renderMsg(msg);
    scrollBottom();
    
    socket.on("chat:read", ({ roomId }) => {
  if (safeStr(roomId) !== safeStr(ROOM_ID)) return;

  document
    .querySelectorAll(".msg-row.me .read-state")
    .forEach(el => {
      el.textContent = "읽음";
    });
});

  });
}

/* ======================================================
   이미지 모달
====================================================== */
function openImageModal(src) {
  imgView.src = src;
  imgModal.style.display = "flex";
}

imgModal.onclick = () => {
  imgModal.style.display = "none";
  imgView.src = "";
};

/* ======================================================
   실행
====================================================== */
(async function init() {
  await loadMe();
  await loadChatList();

  if (ROOM_ID) {
  await loadRoomInfo();
  await loadMessages();
  markRoomAsRead(ROOM_ID); // 🔥 이 줄 추가
}


  initSocket();
})();

sendBtn.onclick = () => {
  const text = msgInput.value.trim();
  if (!text) return;
  msgInput.value = "";
  sendMessage("text", text);
};
