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

// pending 메시지 추적
const PENDING_CLIENT_IDS = new Set();

// 삭제 모달 상태
let DELETE_TARGET_MSG_ID = null;
let DELETE_TARGET_ROW = null;

/* ======================================================
   삭제 모달
====================================================== */
function openDeleteConfirm(msgId, rowEl) {
  if (!deleteModal) return; // 🔥 이 한 줄이 생명줄
  DELETE_TARGET_MSG_ID = msgId;
  DELETE_TARGET_ROW = rowEl;
  deleteModal.style.display = "flex";
}


function closeDeleteConfirm() {
  if (!deleteModal) return;
  DELETE_TARGET_MSG_ID = null;
  DELETE_TARGET_ROW = null;
  deleteModal.style.display = "none";
}


const deleteModal = document.getElementById("deleteConfirmModal");
const confirmCancelBtn = document.getElementById("confirmCancel");
const confirmDeleteBtn = document.getElementById("confirmDelete");

if (confirmCancelBtn) {
  confirmCancelBtn.onclick = closeDeleteConfirm;
}

if (confirmDeleteBtn) {
  confirmDeleteBtn.onclick = async () => {
    if (!DELETE_TARGET_MSG_ID) return;

    await fetch(`${API}/chat/delete`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        roomId: ROOM_ID,
        messageId: DELETE_TARGET_MSG_ID
      })
    });

    if (DELETE_TARGET_ROW) DELETE_TARGET_ROW.remove();

    if (socket) {
      socket.emit("chat:delete", {
        roomId: ROOM_ID,
        messageId: DELETE_TARGET_MSG_ID
      });
    }

    closeDeleteConfirm();
  };
}

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
   메시지 렌더 (🔥 핵심 수정)
====================================================== */
function renderMsg(msg) {
  if (!chatBody || !CURRENT_USER) return;

  const isMe = Number(msg.sender_id) === Number(CURRENT_USER.id);
  const type = msg.message_type || "text";
  const content = type === "image" ? msg.file_url : msg.message;
  if (!content) return;

  // ✅ pending → server 메시지 치환
  if (msg.clientMsgId) {
    const pendingEl = document.querySelector(
      `.msg-row[data-client-msg-id="${msg.clientMsgId}"]`
    );
    if (pendingEl) {
      pendingEl.dataset.messageId = msg.id;
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

  if (isMe) {
    const read = document.createElement("span");
    read.className = "read-state";
    read.textContent = msg.is_read ? "읽음" : "";
    row.appendChild(read);

    // ✅ 삭제 버튼 (기본 숨김)
    const delBtn = document.createElement("button");
    delBtn.className = "msg-delete-btn";
    delBtn.textContent = "삭제";
    delBtn.style.display = "none";

    delBtn.onclick = e => {
      e.stopPropagation();
      openDeleteConfirm(msg.id, row);
    };

    row.appendChild(delBtn);

    // 우클릭 시만 표시
    row.addEventListener("contextmenu", e => {
      e.preventDefault();
      delBtn.style.display = "block";
    });

    // 다른 곳 클릭 시 숨김
    document.addEventListener(
      "click",
      () => (delBtn.style.display = "none"),
      { once: true }
    );
  }

  chatBody.appendChild(row);
}
async function loadChatList() {
  if (!chatListArea) return;

  const res = await fetch(`${API}/chat/rooms`, {
    credentials: "include"
  });
  const data = await res.json();

  console.log("🧪 chat rooms response =", data);

  if (!data.success) return;

  chatListArea.innerHTML = "<h2>메시지</h2>";

  const rooms = Array.isArray(data.rooms) ? data.rooms : [];

  rooms.forEach(room => {
    if (!room.roomId) return;

    const item = document.createElement("div");
    item.className = "chat-item";
    item.dataset.roomId = room.roomId;

    const unreadOn = Number(room.unread) > 0;

    item.innerHTML = `
      <div class="chat-left">
        <span class="chat-unread-badge" style="display:${unreadOn ? "block" : "none"}"></span>
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
   메시지 전송
====================================================== */
async function sendMessage(type, content) {
  if (!ROOM_ID || !content) return;

  const clientMsgId = genClientMsgId();
  PENDING_CLIENT_IDS.add(clientMsgId);

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

/* ======================================================
   Socket.io
====================================================== */
function initSocket() {
  socket = io(API, { withCredentials: true });

  socket.on("connect", () => {
    if (ROOM_ID) socket.emit("chat:join", ROOM_ID);
  });

  socket.on("chat:message", renderMsg);

  socket.on("chat:delete", ({ messageId }) => {
    const el = document.querySelector(
      `.msg-row[data-message-id="${safeStr(messageId)}"]`
    );
    if (el) el.remove();
  });

  socket.on("chat:read", () => {
    document
      .querySelectorAll(".msg-row.me .read-state")
      .forEach(el => (el.textContent = "읽음"));
  });
}
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
   이미지 모달
====================================================== */
function openImageModal(src) {
  if (!imgModal || !imgView) return;
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

  if (ROOM_ID) {
    await loadMessages(); // 🔥 이게 없어서 안 열린다
  }

  initSocket();
})();

sendBtn.onclick = () => {
  const text = msgInput.value.trim();
  if (!text) return;
  msgInput.value = "";
  sendMessage("text", text);
};
