console.log("🔥 chat.js FINAL COMPLETE loaded");

const API = "https://blueon.up.railway.app";

/* ======================================================
   URL 파라미터
====================================================== */
const params = new URLSearchParams(location.search);
const ROOM_ID = params.get("roomId"); // string | null

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

// 내가 낙관적으로 그려둔 메시지들(중복 방지용)
const PENDING_CLIENT_IDS = new Set();

let DELETE_TARGET_MSG_ID = null;
let DELETE_TARGET_ROW = null;

function openDeleteConfirm(msgId, rowEl) {
  DELETE_TARGET_MSG_ID = msgId;
  DELETE_TARGET_ROW = rowEl;
  document.getElementById("deleteConfirmModal").style.display = "flex";
}

function closeDeleteConfirm() {
  DELETE_TARGET_MSG_ID = null;
  DELETE_TARGET_ROW = null;
  document.getElementById("deleteConfirmModal").style.display = "none";
}

document.getElementById("confirmCancel").onclick = closeDeleteConfirm;

document.getElementById("confirmDelete").onclick = async () => {
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

  // UI 즉시 제거
  if (DELETE_TARGET_ROW) DELETE_TARGET_ROW.remove();

  // 상대방에게도 삭제 전파
  socket.emit("chat:delete", {
    roomId: ROOM_ID,
    messageId: DELETE_TARGET_MSG_ID
  });

  closeDeleteConfirm();
};

/* ======================================================
   공통 유틸
====================================================== */
function safeStr(v) {
  if (v == null) return "";
  return String(v);
}

function scrollBottom() {
  if (!chatBody) return;
  chatBody.scrollTop = chatBody.scrollHeight;
}

function genClientMsgId() {
  // 클라 전용 임시 ID (중복 방지/매칭에 도움)
  return `c_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

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
}

/* ======================================================
   좌측 리스트 유틸
====================================================== */
function getChatItem(roomId) {
  return document.querySelector(`.chat-item[data-room-id="${safeStr(roomId)}"]`);
}

function showUnreadBadge(roomId) {
  const item = getChatItem(roomId);
  if (!item) return;
  const badge = item.querySelector(".chat-unread-badge");
  if (badge) badge.style.display = "block";
}

function hideUnreadBadge(roomId) {
  const item = getChatItem(roomId);
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
   좌측 채팅방 목록
   ✅ 프론트에서 한번 더 roomId 기준 중복 방지
====================================================== */
async function loadChatList() {
  const res = await fetch(`${API}/chat/rooms`, { credentials: "include" });
  const data = await res.json();
  if (!data.success) return;

  if (!chatListArea) return;
  chatListArea.innerHTML = "<h2>메시지</h2>";

  const rooms = Array.isArray(data.rooms) ? data.rooms : [];

  // ✅ roomId 기준으로 마지막 것만 남김(중복 보호)
  const map = new Map();
  for (const r of rooms) {
    const rid = safeStr(r.roomId);
    if (!rid) continue;
    map.set(rid, r);
  }
  const uniqRooms = Array.from(map.values());

  uniqRooms.forEach((room) => {
    const roomId = safeStr(room.roomId);
    if (!roomId) return;

    // ✅ DOM 중복 방지(같은 roomId 이미 있으면 추가 안 함)
    if (getChatItem(roomId)) return;

    const item = document.createElement("div");
    item.className = "chat-item";
    item.dataset.roomId = roomId;

    const unreadOn = Number(room.unread) > 0;

    item.innerHTML = `
      <div class="chat-left">
        <span class="chat-unread-badge" style="display:${unreadOn ? "block" : "none"}"></span>

        <img src="${room.avatar || "/assets/default_profile.png"}">
        <div>
          <div style="font-weight:700">
            ${room.nickname || "상대방"}
          </div>
          <div class="chat-last-msg" style="font-size:12px;color:#6b7280">
            ${room.last_msg || ""}
          </div>
        </div>
      </div>
    `;

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

  const res = await fetch(`${API}/chat/room-info?roomId=${encodeURIComponent(ROOM_ID)}`, {
    credentials: "include",
  });
  const data = await res.json();
  if (!data.success) return;

  if (headerImg)  headerImg.src = data.avatar || "/assets/default_profile.png";
  if (headerName) headerName.textContent = data.nickname || "상대방";
}

/* ======================================================
   메시지 로드
====================================================== */
async function loadMessages() {
  if (!ROOM_ID) return;

  const res = await fetch(`${API}/chat/messages?roomId=${encodeURIComponent(ROOM_ID)}`, {
    credentials: "include",
  });
  const data = await res.json();
  if (!data.success) return;

  if (!chatBody) return;
  chatBody.innerHTML = "";

  (data.messages || []).forEach(renderMsg);
  scrollBottom();
}

/* ======================================================
   ✅ 삭제 UI (우클릭)
====================================================== */
function showDeleteBtn(row, messageId, senderId) {
  if (!CURRENT_USER) return;

  // 내 메시지만 삭제 가능
  if (Number(senderId) !== Number(CURRENT_USER.id)) return;

  // 중복 생성 방지
  if (row.querySelector(".msg-delete-btn")) return;

  const btn = document.createElement("button");
  btn.className = "msg-delete-btn";
  btn.textContent = "삭제";

  btn.onclick = async () => {
    if (!confirm("메시지를 삭제할까요?")) return;
    await deleteMessage(messageId);
  };

  row.appendChild(btn);

  // 다른 곳 클릭하면 버튼 제거
  document.addEventListener("click", () => btn.remove(), { once: true });
}

async function deleteMessage(messageId) {
  if (!messageId) return;

  // UI 즉시 제거(낙관적)
  const el = document.querySelector(`.msg-row[data-message-id="${safeStr(messageId)}"]`);
  if (el) el.remove();

  try {
    await fetch(`${API}/chat/delete`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messageId }),
    });
  } catch (e) {
    console.warn("❌ delete network error:", e);
  }
}

/* ======================================================
   메시지 렌더 (최종 완성본)
====================================================== */
function renderMsg(msg) {
  if (!chatBody || !CURRENT_USER) return;

  const senderId = Number(msg.sender_id);
  const isMe = senderId === Number(CURRENT_USER.id);
  const type = msg.message_type || msg.type || "text";

  const content =
    type === "image"
      ? (msg.file_url || msg.message || msg.content)
      : (msg.message || msg.content);

  if (!content) return;

  /* =========================
     row
  ========================= */
  const row = document.createElement("div");
  row.className = "msg-row " + (isMe ? "me" : "other");

  // ✅ 서버 message id (삭제/중복 방지 핵심)
  if (msg.id != null) {
    row.dataset.messageId = String(msg.id);
  }

  // ✅ clientMsgId (낙관적 UI + 소켓 중복 방지용)
  if (msg.clientMsgId) {
    row.dataset.clientMsgId = String(msg.clientMsgId);
  }

  /* =========================
     bubble
  ========================= */
  const bubble = document.createElement("div");
  bubble.className = "msg-bubble";

  if (type === "image") {
    const img = document.createElement("img");
    img.src = content;
    img.alt = "image";
    img.onclick = () => openImageModal(content);
    bubble.appendChild(img);
  } else {
    bubble.textContent = content;
  }

  row.appendChild(bubble);

  /* =========================
     읽음 표시 (내 메시지만)
  ========================= */
  if (isMe) {
    const read = document.createElement("span");
    read.className = "read-state";
    read.textContent = msg.is_read ? "읽음" : "";
    row.appendChild(read);
  }

  /* =========================
     삭제 버튼 (내 메시지만)
  ========================= */
  if (isMe && msg.id != null) {
    const delBtn = document.createElement("button");
    delBtn.className = "msg-delete-btn";
    delBtn.textContent = "삭제";

    delBtn.onclick = (e) => {
      e.stopPropagation();
      openDeleteConfirm(msg.id, row);
    };

    row.appendChild(delBtn);

    // 👉 우클릭 시 삭제 버튼 표시
    row.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      delBtn.style.display = "block";
    });
  }

  chatBody.appendChild(row);
}


/* ======================================================
   읽음 처리
====================================================== */
function markRoomAsRead(roomId) {
  if (!roomId) return;

  fetch(`${API}/chat/read`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ roomId }),
  }).catch(() => {});

  hideUnreadBadge(roomId);
}

/* ======================================================
   메시지 전송 (서버 실패 대비)
====================================================== */
async function sendMessage(type, content) {
  if (!ROOM_ID || !CURRENT_USER) return;
  if (!content) return;

  const clientMsgId = genClientMsgId();
  PENDING_CLIENT_IDS.add(clientMsgId);

  // 1) UI 즉시 반영(낙관적)
  renderMsg({
    id: `pending_${clientMsgId}`,          // 임시 id
    clientMsgId,                          // 임시 clientMsgId
    sender_id: CURRENT_USER.id,
    message_type: type,
    message: type === "text" ? content : null,
    file_url: type === "image" ? content : null,
    is_read: 0,
  });
  scrollBottom();

  // 2) 좌측 프리뷰 즉시 반영
  updateLeftLastMsg(ROOM_ID, type === "text" ? content : "📷 이미지");

  // 3) 서버 저장
  try {
    const res = await fetch(`${API}/chat/send-message`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        roomId: ROOM_ID,
        message_type: type,
        message: type === "text" ? content : null,
        file_url: type === "image" ? content : null,
        clientMsgId, // ✅ 서버가 그대로 브로드캐스트에 넣어주면 중복 완전 해결
      }),
    });

    const data = await res.json().catch(() => null);

    // 성공이면 pending 표시만 해제(서버가 별도 반환해도 여기서 추가 렌더는 안 함)
    if (data && data.success) {
      PENDING_CLIENT_IDS.delete(clientMsgId);
    } else {
      console.warn("❌ send-message failed:", data);
    }
  } catch (e) {
    console.warn("❌ send-message network error:", e);
  }
}

function sendText() {
  const text = (msgInput?.value || "").trim();
  if (!text) return;
  msgInput.value = "";
  sendMessage("text", text);
}

/* ======================================================
   이미지 전송
====================================================== */
if (fileBtn && fileInput) {
  fileBtn.onclick = () => fileInput.click();

  fileInput.onchange = async () => {
    const file = fileInput.files?.[0];
    if (!file) return;

    const fd = new FormData();
    fd.append("image", file);

    try {
      const res = await fetch(`${API}/chat/upload-image`, {
        method: "POST",
        credentials: "include",
        body: fd,
      });

      const data = await res.json();

      if (data.success && data.url) {
        await sendMessage("image", data.url);
      } else {
        console.warn("❌ upload-image failed:", data);
      }
    } catch (e) {
      console.warn("❌ upload-image network error:", e);
    } finally {
      fileInput.value = "";
    }
  };
}

/* ======================================================
   Socket.io
====================================================== */
function initSocket() {
  socket = io(API, { withCredentials: true });

  socket.on("connect", () => {
    if (ROOM_ID) socket.emit("chat:join", ROOM_ID);
  });

  // ✅ 읽음 이벤트: 내가 보고 있는 방에서만 처리
  socket.on("chat:read", ({ roomId }) => {
    if (!ROOM_ID) return;
    if (safeStr(roomId) !== safeStr(ROOM_ID)) return;

    document.querySelectorAll(".msg-row.me .read-state").forEach((el) => {
      el.textContent = "읽음";
    });
  });

  // ✅ 삭제 이벤트 수신
  socket.on("chat:delete", ({ messageId }) => {
    const el = document.querySelector(`.msg-row[data-message-id="${safeStr(messageId)}"]`);
    if (el) el.remove();
  });

  socket.on("chat:message", (msg) => {
    if (!CURRENT_USER) return;

    const roomId = safeStr(msg.room_id || msg.roomId);
    const senderId = Number(msg.sender_id);

    // ✅ 내가 보낸 메시지는 무시(중복 방지 핵심)
    if (senderId === Number(CURRENT_USER.id)) return;

    // ✅ (서버가 clientMsgId를 넣어준다면) pending 중복 완벽 차단
    if (msg.clientMsgId && PENDING_CLIENT_IDS.has(msg.clientMsgId)) {
      return;
    }

    const preview =
      (msg.message_type === "image" ? "📷 이미지" : (msg.message || msg.content || ""));

    updateLeftLastMsg(roomId, preview);

    // 내가 보고 있는 방이면 렌더 + 즉시 읽음 처리
    if (ROOM_ID && roomId === safeStr(ROOM_ID)) {
      renderMsg(msg);
      scrollBottom();
      markRoomAsRead(roomId);
      return;
    }

    // 다른 방이면 뱃지
    showUnreadBadge(roomId);
  });
}

/* ======================================================
   이미지 모달
====================================================== */
function openImageModal(src) {
  if (!imgModal || !imgView) return;
  imgView.src = src;
  imgModal.style.display = "flex";
}

if (imgModal) {
  imgModal.onclick = () => {
    imgModal.style.display = "none";
    if (imgView) imgView.src = "";
  };
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

if (sendBtn) sendBtn.onclick = sendText;
if (msgInput) {
  msgInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      sendText();
    }
  });
}
