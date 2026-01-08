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
====================================================== */
async function loadChatList() {
  const res = await fetch(`${API}/chat/rooms`, {
    credentials: "include",
  });
  const data = await res.json();
  if (!data.success) return;

  if (!chatListArea) return;
  chatListArea.innerHTML = "<h2>메시지</h2>";

  data.rooms.forEach((room) => {
    const roomId = safeStr(room.roomId);

    const item = document.createElement("div");
    item.className = "chat-item";
    item.dataset.roomId = roomId; // ⭐ 핵심

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
   메시지 렌더
====================================================== */
function renderMsg(msg) {
  if (!chatBody || !CURRENT_USER) return;

  const senderId = Number(msg.sender_id);
  const type = msg.message_type || msg.type || "text";

  const content =
    type === "image"
      ? (msg.file_url || msg.message || msg.content)
      : (msg.message || msg.content);

  if (!content) return;

  const row = document.createElement("div");
  row.className = "msg-row " + (senderId === Number(CURRENT_USER.id) ? "me" : "other");

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

  // ✅ 읽음 표시는 "내가 보낸 것"만
  if (senderId === Number(CURRENT_USER.id)) {
    const read = document.createElement("span");
    read.className = "read-state";
    read.textContent = msg.is_read ? "읽음" : "";
    row.appendChild(read);
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

  // 1) UI 즉시 반영(낙관적)
  renderMsg({
    sender_id: CURRENT_USER.id,
    message_type: type,
    message: type === "text" ? content : null,
    file_url: type === "image" ? content : null,
    is_read: 0,
  });
  scrollBottom();

  // 2) 좌측 프리뷰 즉시 반영
  updateLeftLastMsg(ROOM_ID, type === "text" ? content : "📷 이미지");

  // 3) 서버 저장 (실패해도 UI는 유지)
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
      }),
    });

    const data = await res.json().catch(() => null);

    // 서버가 saved message를 주면, socket 중복 방지용으로 여기서는 추가 렌더 안 함
    // (이미 UI에 렌더된 상태라 중복 출력되기 쉬움)
    if (!data || !data.success) {
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
  // ✅ 반드시 서버 URL 명시 (Railway에서 상대경로 연결 꼬이는 거 방지)
  socket = io(API, { withCredentials: true });

  socket.on("connect", () => {
    if (ROOM_ID) socket.emit("chat:join", ROOM_ID);
  });

  // ✅ 읽음 이벤트: 내가 보고 있는 방에서만 처리
  socket.on("chat:read", ({ roomId }) => {
    if (!ROOM_ID) return;
    if (safeStr(roomId) !== safeStr(ROOM_ID)) return;

    // 내가 보낸 메시지들의 읽음 표시 켬
    document.querySelectorAll(".msg-row.me .read-state").forEach((el) => {
      el.textContent = "읽음";
    });
  });

socket.on("chat:message", msg => {
  const roomId = String(msg.room_id || msg.roomId);
  const senderId = Number(msg.sender_id);

  // 🔥 내가 보낸 메시지는 무시 (중복 방지)
  if (senderId === CURRENT_USER.id) return;

  const preview =
    msg.message_type === "image"
      ? "📷 이미지"
      : (msg.message || "");

  updateLeftLastMsg(roomId, preview);

  if (ROOM_ID && roomId === String(ROOM_ID)) {
    renderMsg(msg);
    scrollBottom();
    markRoomAsRead(roomId);
    return;
  }

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

    // 방 들어오면 즉시 읽음 처리 + 뱃지 제거
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
