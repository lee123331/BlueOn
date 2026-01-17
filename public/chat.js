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

/* 삭제 모달(HTML에 이미 존재) */
const deleteModal = document.getElementById("deleteConfirmModal");
const confirmCancelBtn = document.getElementById("confirmCancel");
const confirmDeleteBtn = document.getElementById("confirmDelete");

/* ======================================================
   상태
====================================================== */
let CURRENT_USER = null;
let socket = null;

// 내가 낙관적으로 그려둔 메시지들(중복 방지용)
const PENDING_CLIENT_IDS = new Set();

// 삭제 모달 상태
let DELETE_TARGET_MSG_ID = null;
let DELETE_TARGET_ROW = null;



/* ======================================================
   공통 유틸
====================================================== */
function safeStr(v) {
  return v == null ? "" : String(v);
}

function pickRoomId(r) {
  // 서버/프론트 키가 섞여도 무조건 roomId 뽑아냄
  return safeStr(r?.roomId || r?.room_id || r?.id || r?.room);
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
  const el = item.querySelector(".chat-last");
  if (el) el.textContent = text || "";
}

function pickRoomId(r) {
  return safeStr(r?.roomId || r?.room_id || r?.id || r?.room || r?.roomID);
}

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
        badge.style.display = "block";
        // 점 말고 숫자로 보이게 하고 싶으면 아래처럼:
        badge.textContent = String(cnt);
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
   삭제 모달
====================================================== */
/* ======================================================
   🗑 메시지 삭제 처리 (완성 안정판)
====================================================== */

/* =========================
   삭제 확인 모달 열기
========================= */
function openDeleteConfirm(messageId, rowEl) {
  DELETE_TARGET_MSG_ID = messageId;
  DELETE_TARGET_ROW = rowEl;

  if (deleteModal) {
    deleteModal.style.display = "flex";
  }
}

/* =========================
   삭제 확인 모달 닫기
========================= */
function closeDeleteConfirm() {
  DELETE_TARGET_MSG_ID = null;
  DELETE_TARGET_ROW = null;

  if (deleteModal) {
    deleteModal.style.display = "none";
  }
}

/* =========================
   취소 버튼
========================= */
if (confirmCancelBtn) {
  confirmCancelBtn.onclick = closeDeleteConfirm;
}

/* =========================
   삭제 확정 버튼
========================= */
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

      const data = await res.json();
      if (!data.success) {
        console.warn("❌ 서버 삭제 실패", data);
      }
    } catch (e) {
      console.warn("❌ delete request error", e);
    }
  };
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
   좌측 채팅방 목록
====================================================== */
async function loadChatList() {
  if (!chatListArea) return;

  const res = await fetch(`${API}/chat/rooms`, { credentials: "include" });
  const data = await res.json().catch(() => null);

  console.log("🧪 chat rooms response =", data);

  if (!data || !data.success) return;

  chatListArea.innerHTML = "<h2>메시지</h2>";

  const rooms = Array.isArray(data.rooms) ? data.rooms : [];

  // ✅ roomId 기준 중복 제거 (snake/camel 모두 대응)
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

    if (getChatItem(roomId)) return;

    const item = document.createElement("div");
    item.className = "chat-item";
    item.dataset.roomId = roomId;

    // unread가 없을 수도 있으니 0 처리
    const unreadOn = Number(room.unread || 0) > 0;

    item.innerHTML = `
      <div class="chat-left">
        <span class="chat-unread-badge" style="display:${unreadOn ? "block" : "none"}"></span>
        <img src="${room.avatar || "/assets/default_profile.png"}" alt="avatar">
        <div class="chat-texts">
          <div class="chat-name">${room.nickname || "상대방"}</div>
          <div class="chat-last">${room.last_msg || ""}</div>
        </div>
      </div>
    `;

    item.onclick = () => {
      hideUnreadBadge(roomId);
      location.href = `/chat.html?roomId=${encodeURIComponent(roomId)}`;
    };

    chatListArea.appendChild(item);
  });
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
   읽음 처리 (서버에 방 읽음 요청)
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
   ✅ 메시지 렌더 (삭제 / 읽음 / 이미지 / 중복치환 최종 안정판)
====================================================== */
function renderMsg(msg) {
  if (!chatBody || !CURRENT_USER) return;

   // 🔥 이 줄 추가
  if (msg.id == null && msg.message_id != null) {
    msg.id = msg.message_id;
  }
  
  const senderId = Number(msg.sender_id);
  const isMe = senderId === Number(CURRENT_USER.id);
  const type = msg.message_type || msg.type || "text";

  const content =
    type === "image"
      ? (msg.file_url || msg.message || msg.content)
      : (msg.message || msg.content);

  if (!content) return;

  /* ======================================================
     1️⃣ pending → 서버 메시지 치환 (clientMsgId 기준)
  ====================================================== */
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

  /* ======================================================
     2️⃣ messageId 기준 중복 방지
  ====================================================== */
  if (msg.id != null) {
    const exist = document.querySelector(
      `.msg-row[data-message-id="${safeStr(msg.id)}"]`
    );
    if (exist) return;
  }

  /* ======================================================
     3️⃣ row 생성
  ====================================================== */
  const row = document.createElement("div");
  row.className = `msg-row ${isMe ? "me" : "other"}`;

  if (msg.id != null) row.dataset.messageId = safeStr(msg.id);
  if (msg.clientMsgId) row.dataset.clientMsgId = safeStr(msg.clientMsgId);

  /* ======================================================
     4️⃣ 말풍선
  ====================================================== */
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

  /* ======================================================
     5️⃣ 읽음 표시 (내 메시지만)
  ====================================================== */
  if (isMe) {
    const read = document.createElement("span");
    read.className = "read-state";
    read.textContent = msg.is_read ? "읽음" : "";
    row.appendChild(read);
  }

  /* ======================================================
     6️⃣ 🔥 삭제 버튼 (내 메시지면 무조건 생성)
     - display 제어는 CSS에만 맡긴다
  ====================================================== */
  if (isMe) {
    const delBtn = document.createElement("button");
    delBtn.className = "msg-delete-btn";
    delBtn.textContent = "삭제";

   delBtn.onclick = (e) => {
  e.stopPropagation();

  const realId = row.dataset.messageId;

  if (!realId || String(realId).startsWith("pending")) {
    return; // 🔥 pending 메시지는 삭제 불가
  }

  openDeleteConfirm(realId, row);
};


    row.appendChild(delBtn);
  }

  /* ======================================================
     7️⃣ DOM 추가
  ====================================================== */
  chatBody.appendChild(row);
}


/* ======================================================
   메시지 전송 (중복 방지: pending + socket 차단)
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
        clientMsgId, // ✅ 서버가 브로드캐스트에 그대로 넣어주면 pending 치환이 정확해짐
      }),
    });

    const data = await res.json().catch(() => null);

    // 서버가 clientMsgId를 브로드캐스트로 다시 보내줄 거라 pending 치환됨.
    // 혹시 서버가 브로드캐스트에 clientMsgId를 안 넣는 경우:
    // -> sender_id 체크로 socket 중복이 막혀서 내 메시지는 2번 안 보임.
    if (data && data.success) {
      // 성공이면 pending은 socket의 server msg가 들어오면 치환될 것.
      // 다만 server가 clientMsgId를 안 실어주면 pending이 남을 수 있으니
      // 서버가 messageId를 반환한다면 여기서 치환해줄 수도 있음(선택).
      // (현재는 호환성 위해 보수적으로 유지)
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
  msgInput.value = "";
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
   Socket.io (최종 안정판)
====================================================== */
function initSocket() {
  socket = io(API, { withCredentials: true });

  socket.on("connect", () => {
    if (ROOM_ID) {
      socket.emit("chat:join", ROOM_ID);
    }
  });

  /* =========================
     메시지 수신
  ========================= */
  socket.on("chat:message", async (msg) => {
    if (!CURRENT_USER) return;

    const roomId = safeStr(msg.room_id || msg.roomId);
    if (!roomId) return;

    const preview =
      msg.message_type === "image"
        ? "📷 이미지"
        : (msg.message || msg.content || "");

    // ✅ 좌측 리스트 미리보기 항상 갱신
    updateLeftLastMsg(roomId, preview);

    // ✅ 내가 보고 있는 방이 아니면 뱃지만 표시
   if (!ROOM_ID || roomId !== safeStr(ROOM_ID)) {
  await applyRoomUnreadCounts(); // ✅ DB 기준으로 확정 반영
  return;
}


    // ✅ 내가 보낸 메시지는 socket에서 무시 (중복 방지 핵심)
    if (Number(msg.sender_id) === Number(CURRENT_USER.id)) {
      return;
    }

    // ✅ pending 메시지 중복 차단
    if (msg.clientMsgId && PENDING_CLIENT_IDS.has(msg.clientMsgId)) {
      return;
    }

    // ✅ 실제 렌더
    renderMsg(msg);
    scrollBottom();

    // ✅ 읽음 처리
    markRoomAsRead(ROOM_ID);
  });

  /* =========================
     읽음 이벤트 (⚠️ 반드시 여기서 한 번만!)
  ========================= */
  socket.on("chat:read", ({ roomId }) => {
    if (!ROOM_ID) return;
    if (safeStr(roomId) !== safeStr(ROOM_ID)) return;

    document
      .querySelectorAll(".msg-row.me .read-state")
      .forEach((el) => {
        el.textContent = "읽음";
      });
  });

  /* =========================
     삭제 이벤트
  ========================= */
  socket.on("chat:delete", ({ messageId, roomId }) => {
    // roomId가 있으면 같은 방만 처리 (서버 호환용)
    if (roomId && ROOM_ID && safeStr(roomId) !== safeStr(ROOM_ID)) return;

    const el = document.querySelector(
      `.msg-row[data-message-id="${safeStr(messageId)}"]`
    );
    if (el) el.remove();
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
  await applyRoomUnreadCounts(); // ✅ 방별 unread 반영

  if (ROOM_ID) {
    await loadRoomInfo();     // ✅ 상단 Loading... 해결
    await loadMessages();     // ✅ 채팅 열림
    markRoomAsRead(ROOM_ID);  // ✅ 들어오자마자 읽음 처리
    hideUnreadBadge(ROOM_ID);
  } else {
    // roomId 없을 때 상단 문구 방치 방지
    if (headerName && headerName.textContent === "Loading...") {
      headerName.textContent = "대화를 선택하세요";
    }
  }

  initSocket();
})();

/* ======================================================
   입력 이벤트 (중복 전송 방지)
   - sendBtn.onclick은 한 번만 지정
   - Enter 키도 한 번만 등록
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
