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
const chatBody = document.getElementById("chatBody");
const msgInput = document.getElementById("msgInput");
const sendBtn = document.getElementById("sendBtn");
const fileBtn = document.getElementById("fileBtn");
const fileInput = document.getElementById("fileInput");

const headerImg = document.getElementById("chatProfileImg");
const headerName = document.getElementById("chatProfileName");

const imgModal = document.getElementById("imgModal");
const imgView = document.getElementById("imgModalView");

/* 메시지 삭제 모달 */
const deleteModal = document.getElementById("deleteConfirmModal");
const confirmCancelBtn = document.getElementById("confirmCancel");
const confirmDeleteBtn = document.getElementById("confirmDelete");

/* 채팅방 삭제 모달 */
const roomDeleteModal = document.getElementById("roomDeleteModal");
const roomDeleteCancel = document.getElementById("roomDeleteCancel");
const roomDeleteConfirm = document.getElementById("roomDeleteConfirm");

/* ======================================================
   상태
====================================================== */
let CURRENT_USER = null;
let socket = null;

// 내가 낙관적으로 그려둔 메시지들(중복 방지용)
const PENDING_CLIENT_IDS = new Set();

// 메시지 삭제 모달 상태
let DELETE_TARGET_MSG_ID = null;
let DELETE_TARGET_ROW = null;

// 채팅방 삭제 모달 상태
let PENDING_DELETE_ROOM_ID = null;

/* ======================================================
   공통 유틸
====================================================== */
function safeStr(v) {
  return v == null ? "" : String(v);
}

function scrollBottom() {
  if (!chatBody) return;
  chatBody.scrollTop = chatBody.scrollHeight;
}

function genClientMsgId() {
  return `c_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function getChatItem(roomId) {
  return document.querySelector(`.chat-item[data-room-id="${safeStr(roomId)}"]`);
}

function showUnreadBadge(roomId, cnt = null) {
  const item = getChatItem(roomId);
  if (!item) return;
  const badge = item.querySelector(".chat-unread-badge");
  if (!badge) return;

  const n = cnt == null ? null : Number(cnt);
  if (n != null && n > 0) {
    badge.style.display = "inline-flex";
    badge.textContent = n > 99 ? "99+" : String(n);
  } else {
    badge.style.display = "inline-flex";
    if (!badge.textContent) badge.textContent = "•";
  }
}

function hideUnreadBadge(roomId) {
  const item = getChatItem(roomId);
  if (!item) return;
  const badge = item.querySelector(".chat-unread-badge");
  if (!badge) return;
  badge.style.display = "none";
  badge.textContent = "";
}

function updateLeftLastMsg(roomId, text) {
  const item = getChatItem(roomId);
  if (!item) return;
  const el = item.querySelector(".chat-last");
  if (el) el.textContent = text || "";
}

function pickRoomId(r) {
  return safeStr(r?.roomId || r?.room_id || r?.id || r?.room || r?.roomID);
}

/* ======================================================
   unread 동기화
====================================================== */
async function applyRoomUnreadCounts() {
  try {
    const res = await fetch(`${API}/chat/unread-count`, { credentials: "include" });
    const data = await res.json().catch(() => null);
    if (!data || !data.success) return;

    const roomsMap = data.rooms || {};

    document.querySelectorAll(".chat-item[data-room-id]").forEach((item) => {
      const rid = safeStr(item.dataset.roomId);
      const cnt = Number(roomsMap[rid] || 0);

      const badge = item.querySelector(".chat-unread-badge");
      if (!badge) return;

      if (cnt > 0) {
        badge.style.display = "inline-flex";
        badge.textContent = cnt > 99 ? "99+" : String(cnt);
      } else {
        badge.style.display = "none";
        badge.textContent = "";
      }
    });
  } catch (e) {
    console.warn("applyRoomUnreadCounts fail", e);
  }
}

/* ======================================================
   🗑 메시지 삭제 모달
====================================================== */
function openDeleteConfirm(messageId, rowEl) {
  DELETE_TARGET_MSG_ID = messageId;
  DELETE_TARGET_ROW = rowEl;

  if (deleteModal) deleteModal.style.display = "flex";
}

function closeDeleteConfirm() {
  DELETE_TARGET_MSG_ID = null;
  DELETE_TARGET_ROW = null;

  if (deleteModal) deleteModal.style.display = "none";
}

if (confirmCancelBtn) confirmCancelBtn.onclick = closeDeleteConfirm;

if (deleteModal) {
  deleteModal.addEventListener("click", (e) => {
    if (e.target === deleteModal) closeDeleteConfirm();
  });
}

if (confirmDeleteBtn) {
  confirmDeleteBtn.onclick = async () => {
    if (!DELETE_TARGET_MSG_ID) return;

    const targetId = DELETE_TARGET_MSG_ID;
    const targetRow = DELETE_TARGET_ROW;

    // UI 즉시 제거
    if (targetRow) targetRow.remove();
    closeDeleteConfirm();

    try {
      const res = await fetch(`${API}/chat/delete`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roomId: ROOM_ID,
          messageId: targetId,
        }),
      });

      const data = await res.json().catch(() => null);
      if (!data || !data.success) {
        console.log("❌ delete failed:", data, "roomId=", ROOM_ID);
        // 실패 시 동기화 (복구 난이도 낮춤)
        location.reload();
      }
    } catch (e) {
      console.warn("❌ delete request error", e);
      location.reload();
    }
  };
}

/* ======================================================
   🗑 채팅방 삭제 모달 (전역 1회)
====================================================== */
function openRoomDeleteModal(roomId) {
  PENDING_DELETE_ROOM_ID = safeStr(roomId);
  if (roomDeleteModal) roomDeleteModal.style.display = "flex";
}

function closeRoomDeleteModal() {
  PENDING_DELETE_ROOM_ID = null;
  if (roomDeleteModal) roomDeleteModal.style.display = "none";
}

if (roomDeleteCancel) roomDeleteCancel.onclick = closeRoomDeleteModal;

if (roomDeleteModal) {
  roomDeleteModal.addEventListener("click", (e) => {
    if (e.target === roomDeleteModal) closeRoomDeleteModal();
  });
}

/* ======================================================
   로그인 유저
====================================================== */
async function loadMe() {
  const res = await fetch(`${API}/auth/me`, { credentials: "include" });
  const data = await res.json().catch(() => null);

  if (!data || !data.success) {
    location.href = "/login.html";
    return;
  }
  CURRENT_USER = data.user;
}

/* ======================================================
   좌측 채팅방 목록
====================================================== */
async function loadChatList() {
  const listEl = document.getElementById("chatList");
  if (!listEl) return;

  const res = await fetch(`${API}/chat/rooms`, { credentials: "include" });
  const data = await res.json().catch(() => null);

  console.log("🧪 chat rooms response =", data);

  if (!data || !data.success) return;

  listEl.innerHTML = "<h2>메시지</h2>";

  const rooms = Array.isArray(data.rooms) ? data.rooms : [];

  // ✅ roomId 기준 중복 제거
  const map = new Map();
  for (const r of rooms) {
    const rid = pickRoomId(r);
    if (!rid) continue;
    map.set(rid, r);
  }

  const uniqRooms = Array.from(map.values());

  uniqRooms.forEach((room) => {
    const roomId = pickRoomId(room);
    if (!roomId) return;

    const item = document.createElement("div");
    item.className = "chat-item";
    item.dataset.roomId = safeStr(roomId);

    const unreadOn = Number(room.unread || 0) > 0;

    item.innerHTML = `
      <div class="chat-left">
        <img src="${room.avatar || "/assets/default_profile.png"}" alt="avatar">
        <div class="chat-texts">
          <div class="chat-name-row">
            <div class="chat-name">${room.nickname || "상대방"}</div>
            <span class="chat-unread-badge" style="display:${unreadOn ? "inline-flex" : "none"}">
              ${unreadOn ? (Number(room.unread) > 99 ? "99+" : String(Number(room.unread || 0))) : ""}
            </span>
          </div>
          <div class="chat-last">${room.last_msg || ""}</div>
        </div>
      </div>

      <button class="room-delete-btn" type="button" title="채팅방 삭제" aria-label="채팅방 삭제">🗑</button>

    `;

// ✅ 방 이동은 item onclick으로 유지
item.onclick = (e) => {
  const delBtn = e.target.closest(".room-delete-btn");
  if (delBtn) {
    e.preventDefault();
    e.stopPropagation();

    openRoomDeleteModal(roomId); // ✅ 여기서 모달 띄움
    return;
  }

  hideUnreadBadge(roomId);
  location.href = `/chat.html?roomId=${encodeURIComponent(roomId)}`;
};

  });
}

/* ======================================================
   채팅방 삭제 유틸
====================================================== */
function removeRoomFromUI(roomId) {
  const el = document.querySelector(`.chat-item[data-room-id="${safeStr(roomId)}"]`);
  if (el) el.remove();
}

function closeIfCurrentRoom(roomId) {
  const current = safeStr(new URLSearchParams(location.search).get("roomId"));
  if (safeStr(roomId) === current) {
    location.href = "/chat.html";
  }
}

/* ======================================================
   🗑 채팅방 삭제 확정 처리 (모달 버튼)
====================================================== */
if (roomDeleteConfirm) {
  roomDeleteConfirm.onclick = async () => {
    if (!PENDING_DELETE_ROOM_ID) return;

    const roomId = PENDING_DELETE_ROOM_ID;
    closeRoomDeleteModal();

    // ✅ 즉시 UI 제거
    removeRoomFromUI(roomId);

    try {
      const res = await fetch(`${API}/chat/delete-room`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomId }),
      });

      const data = await res.json().catch(() => null);
      if (!data || !data.success) {
        // 실패 시 동기화
        alert("삭제 실패: " + (data?.message || "UNKNOWN"));
        location.reload();
        return;
      }

      closeIfCurrentRoom(roomId);
    } catch (e) {
      console.warn("delete-room error", e);
      location.reload();
    }
  };
}


/* ======================================================
   상단 방 정보
====================================================== */
async function loadRoomInfo() {
  if (!ROOM_ID) return;

  const res = await fetch(`${API}/chat/room-info?roomId=${encodeURIComponent(ROOM_ID)}`, {
    credentials: "include",
  });
  const data = await res.json().catch(() => null);
  if (!data || !data.success) return;

  if (headerImg) headerImg.src = data.avatar || "/assets/default_profile.png";
  if (headerName) headerName.textContent = data.nickname || "상대방";
}

/* ======================================================
   메시지 로드
====================================================== */
async function loadMessages() {
  if (!ROOM_ID || !chatBody) return;

  const res = await fetch(`${API}/chat/messages?roomId=${encodeURIComponent(ROOM_ID)}`, {
    credentials: "include",
  });
  const data = await res.json().catch(() => null);
  if (!data || !data.success) return;

  chatBody.innerHTML = "";
  (data.messages || []).forEach(renderMsg);
  scrollBottom();
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
   ✅ 메시지 렌더
====================================================== */
function renderMsg(msg) {
  if (!chatBody || !CURRENT_USER) return;

  // id 필드 호환
  if (msg.id == null && msg.message_id != null) msg.id = msg.message_id;

  const senderId = Number(msg.sender_id);
  const isMe = senderId === Number(CURRENT_USER.id);
  const type = msg.message_type || msg.type || "text";

  const content =
    type === "image"
      ? (msg.file_url || msg.message || msg.content)
      : (msg.message || msg.content);

  if (!content) return;

  // 1) pending 치환
  if (msg.clientMsgId) {
    const pendingEl = document.querySelector(
      `.msg-row[data-client-msg-id="${safeStr(msg.clientMsgId)}"]`
    );

    if (pendingEl && msg.id != null) {
      pendingEl.dataset.messageId = safeStr(msg.id);

      const readEl = pendingEl.querySelector(".read-state");
      if (readEl) readEl.textContent = msg.is_read ? "읽음" : "";

      PENDING_CLIENT_IDS.delete(msg.clientMsgId);
      return;
    }
  }

  // 2) messageId 중복 방지
  if (msg.id != null) {
    const exist = document.querySelector(
      `.msg-row[data-message-id="${safeStr(msg.id)}"]`
    );
    if (exist) return;
  }

  // 3) row 생성
  const row = document.createElement("div");
  row.className = `msg-row ${isMe ? "me" : "other"}`;

  if (msg.id != null) row.dataset.messageId = safeStr(msg.id);
  if (msg.clientMsgId) row.dataset.clientMsgId = safeStr(msg.clientMsgId);

  // 4) 말풍선
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

  // 5) 읽음 표시(내 메시지)
  if (isMe) {
    const read = document.createElement("span");
    read.className = "read-state";
    read.textContent = msg.is_read ? "읽음" : "";
    row.appendChild(read);
  }

  // 6) 메시지 삭제 버튼(내 메시지)
  if (isMe) {
    const delBtn = document.createElement("button");
    delBtn.className = "msg-delete-btn";
    delBtn.type = "button";
    delBtn.textContent = "삭제";

    delBtn.onclick = (e) => {
      e.stopPropagation();

      const realId = row.dataset.messageId;
      if (!realId || String(realId).startsWith("pending")) return;

      openDeleteConfirm(realId, row);
    };

    row.appendChild(delBtn);
  }

  // 7) 추가
  chatBody.appendChild(row);
}

/* ======================================================
   메시지 전송
====================================================== */
async function sendMessage(type, content) {
  if (!ROOM_ID || !CURRENT_USER || !content) return;

  const clientMsgId = genClientMsgId();
  PENDING_CLIENT_IDS.add(clientMsgId);

  // 1) UI 즉시 렌더(pending)
  renderMsg({
    id: `pending_${clientMsgId}`,
    clientMsgId,
    sender_id: CURRENT_USER.id,
    message_type: type,
    message: type === "text" ? content : null,
    file_url: type === "image" ? content : null,
    is_read: 0,
  });
  scrollBottom();

  // 2) 좌측 프리뷰 즉시 갱신
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
        clientMsgId,
      }),
    });

    const data = await res.json().catch(() => null);

    if (data && data.success) {
      // 서버 브로드캐스트가 clientMsgId 포함이면 pending 치환됨
      PENDING_CLIENT_IDS.delete(clientMsgId);
    } else {
      console.warn("❌ send-message failed:", data);
      PENDING_CLIENT_IDS.delete(clientMsgId);
    }
  } catch (e) {
    console.warn("❌ send-message network error:", e);
    PENDING_CLIENT_IDS.delete(clientMsgId);
  }
}

function sendText() {
  const text = (msgInput?.value || "").trim();
  if (!text) return;
  if (msgInput) msgInput.value = "";
  sendMessage("text", text);
}

/* ======================================================
   이미지 업로드 + 전송
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

      const data = await res.json().catch(() => null);
      if (data && data.success && data.url) {
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
  if (typeof window.io !== "function") {
    console.warn("❌ socket.io not loaded (window.io undefined)");
    return;
  }

  if (socket) {
    try { socket.disconnect(); } catch {}
    socket = null;
  }

  socket = window.io(API, {
    withCredentials: true,
    transports: ["polling", "websocket"],
    upgrade: true,
    reconnection: true,
    reconnectionAttempts: 20,
    reconnectionDelay: 800,
    reconnectionDelayMax: 3000,
    timeout: 10000,
  });

  function joinRoomIfNeeded() {
    if (!ROOM_ID) return;

    const rid = String(ROOM_ID);

    socket.emit("chat:join", rid, (ack) => {
      const ok =
        ack === true ||
        ack === "OK" ||
        (ack && typeof ack === "object" && ack.ok === true);

      console.log("✅ chat:join ack =", ack, "parsed ok =", ok, "room =", rid);
    });
  }

  let SYNC_LOCK = false;
  async function syncListAndBadges(reason = "") {
    if (SYNC_LOCK) return;
    SYNC_LOCK = true;

    try {
      await loadChatList();
      await applyRoomUnreadCounts();
      if (ROOM_ID) hideUnreadBadge(ROOM_ID);
      if (reason) console.log("🔄 syncListAndBadges:", reason);
    } catch (e) {
      console.warn("❌ syncListAndBadges fail:", reason, e);
    } finally {
      SYNC_LOCK = false;
    }
  }

  socket.on("connect", async () => {
    console.log("✅ socket connected:", socket.id, "ROOM_ID =", ROOM_ID);
    joinRoomIfNeeded();
    await syncListAndBadges("connect");
  });

  socket.on("reconnect", async (attempt) => {
    console.log("🔁 socket reconnected:", attempt, "ROOM_ID =", ROOM_ID);
    joinRoomIfNeeded();
    await syncListAndBadges("reconnect");
  });

  socket.on("connect_error", (e) => {
    console.warn("❌ socket connect_error:", e?.message || e);
  });

  socket.on("disconnect", (reason) => {
    console.warn("🔌 socket disconnected:", reason);
  });

  socket.on("chat:joined", (payload) => {
    const rid = safeStr(payload?.roomId || payload);
    console.log("✅ joined room:", rid, "payload =", payload);
  });

  socket.on("chat:notify", async (p) => {
    console.log("🔔 chat:notify:", p);
    await syncListAndBadges("notify");
  });

  socket.on("chat:message", async (msg) => {
    if (!CURRENT_USER) return;

    const roomId = safeStr(msg?.room_id || msg?.roomId);
    if (!roomId) return;

    const preview =
      msg.message_type === "image"
        ? "📷 이미지"
        : (msg.message || msg.content || "");

    updateLeftLastMsg(roomId, preview);

    if (!getChatItem(roomId)) {
      await syncListAndBadges("message_room_not_in_list");
    }

    if (!ROOM_ID || roomId !== safeStr(ROOM_ID)) {
      await syncListAndBadges("message_not_current_room");
      return;
    }

    // 내 메시지도 pending 치환을 위해 render
    if (Number(msg.sender_id) === Number(CURRENT_USER.id)) {
      renderMsg(msg);
      return;
    }

    renderMsg(msg);
    scrollBottom();

    markRoomAsRead(ROOM_ID);
    hideUnreadBadge(ROOM_ID);
  });

  // ✅ 방 삭제 브로드캐스트
  socket.on("chat:room-deleted", ({ roomId }) => {
    const rid = safeStr(roomId);
    removeRoomFromUI(rid);

    const current = safeStr(new URLSearchParams(location.search).get("roomId"));
    if (rid === current) location.href = "/chat.html";
  });

  socket.on("chat:delete", ({ messageId, roomId }) => {
    if (roomId && ROOM_ID && safeStr(roomId) !== safeStr(ROOM_ID)) return;

    const el = document.querySelector(
      `.msg-row[data-message-id="${safeStr(messageId)}"]`
    );
    if (el) el.remove();
  });

  socket.on("chat:read", ({ roomId }) => {
    if (!ROOM_ID) return;
    if (safeStr(roomId) !== safeStr(ROOM_ID)) return;

    document.querySelectorAll(".msg-row.me .read-state").forEach((el) => {
      el.textContent = "읽음";
    });
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
  await applyRoomUnreadCounts();

  if (ROOM_ID) {
    await loadRoomInfo();
    await loadMessages();

    markRoomAsRead(ROOM_ID);
    hideUnreadBadge(ROOM_ID);
  } else {
    if (headerName && headerName.textContent === "Loading...") {
      headerName.textContent = "대화를 선택하세요";
    }
  }

  initSocket();
})();

/* ======================================================
   입력 이벤트
====================================================== */
if (sendBtn) sendBtn.onclick = sendText;

if (msgInput) {
  msgInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      sendText();
    }
  });
}
