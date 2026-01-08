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
   - 핵심: data-room-id로 방 찾기 가능하게 만들기
====================================================== */
async function loadChatList() {
  const res = await fetch(`${API}/chat/rooms`, { credentials: "include" });
  const data = await res.json();
  if (!data.success) return;

  chatListArea.innerHTML = "<h2>메시지</h2>";

  data.rooms.forEach(room => {
    const roomIdStr = String(room.roomId);

    const div = document.createElement("div");
    div.className = "chat-item";
    div.dataset.roomId = roomIdStr;

    div.innerHTML = `
      <div class="chat-left">
        <span class="chat-unread-dot"
              style="display:${Number(room.unread) > 0 ? "block" : "none"}"></span>

        <img src="${room.avatar || "/assets/default_profile.png"}">
        <div>
          <div style="font-weight:700">${room.nickname || "상대방"}</div>
          <div class="chat-last-msg" style="font-size:12px;color:#6b7280">
            ${room.last_msg || ""}
          </div>
        </div>
      </div>
    `;

    div.onclick = () => {
      // 클릭 즉시 점 숨김 (UI 반응)
      const dot = div.querySelector(".chat-unread-dot");
      if (dot) dot.style.display = "none";

      location.href = `/chat.html?roomId=${roomIdStr}`;
    };

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
   - 핵심: 읽음 표시 span 항상 생성(내 메시지), 나중에 업데이트 가능
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

  // ✅ 읽음 표시(내가 보낸 메시지에만)
  if (senderId === CURRENT_USER.id) {
    const read = document.createElement("span");
    read.className = "read-state";
    read.textContent = msg.is_read ? "읽음" : ""; // 서버가 is_read 주면 반영
    wrap.appendChild(read);
  }

  chatBody.appendChild(wrap);
}

/* ======================================================
   내 메시지들 읽음 UI 강제 갱신
====================================================== */
function setAllMyMsgsReadUI() {
  document
    .querySelectorAll(".msg.me .read-state")
    .forEach(el => (el.textContent = "읽음"));
}

/* ======================================================
   메시지 전송 (텍스트/이미지 공용)
====================================================== */
function sendMessage(type, content) {
  // 🔥 즉시 렌더(내 메시지 -> 일단 읽음표시는 비움)
  renderMsg({
    sender_id: CURRENT_USER.id,
    message_type: type,
    message: type === "text" ? content : null,
    file_url: type === "image" ? content : null,
    is_read: 0
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

  // 좌측 last_msg 미리보기 즉시 업데이트(현재 방)
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

  try {
    const fd = new FormData();
    fd.append("image", file);

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

    sendMessage("image", upData.url);
  } catch (err) {
    console.error("❌ image send error", err);
  } finally {
    fileInput.value = "";
  }
};

/* ======================================================
   읽음 처리 (서버)
====================================================== */
function markRoomAsRead(roomId) {
  if (!roomId) return;

  // 1) 서버에 읽음 처리
  fetch(`${API}/chat/read`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ roomId })
  }).catch(err => {
    console.error("❌ read error", err);
  });

  // 2) 좌측 빨간 점 즉시 숨김
  hideUnreadDot(roomId);

  // 3) 내가 보낸 메시지 읽음 UI(상대가 읽었다는 이벤트는 서버/소켓에 따라 다를 수 있어서)
  //    이건 '상대가 읽음' 확정은 아니지만, 최소 이벤트가 올 때 아래에서 확정 표시됨.
}

/* ======================================================
   좌측 리스트 유틸 (방 찾기/점/미리보기)
====================================================== */
function getChatItem(roomId) {
  return document.querySelector(`.chat-item[data-room-id="${String(roomId)}"]`);
}

function showUnreadDot(roomId) {
  const item = getChatItem(roomId);
  if (!item) return;
  const dot = item.querySelector(".chat-unread-dot");
  if (dot) dot.style.display = "block";
}

function hideUnreadDot(roomId) {
  const item = getChatItem(roomId);
  if (!item) return;
  const dot = item.querySelector(".chat-unread-dot");
  if (dot) dot.style.display = "none";
}

function updateLeftLastMsg(roomId, text) {
  const item = getChatItem(roomId);
  if (!item) return;
  const last = item.querySelector(".chat-last-msg");
  if (last) last.textContent = text || "";
}

/* ======================================================
   Socket.io
   - 핵심:
     1) 다른 방 메시지 오면 data-room-id로 정확히 찾아서 빨간 점 켜기
     2) 현재 방 메시지 오면 읽음 처리 + 좌측 점 끄기
     3) (가능하면) read 이벤트 받으면 내 메시지 "읽음" 처리
====================================================== */
function initSocket() {
  socket = io({ withCredentials: true });

  socket.on("connect", () => {
    if (ROOM_ID) socket.emit("chat:join", ROOM_ID);
    console.log("🔌 socket connected");
  });

  // ✅ 메시지 수신
  socket.on("chat:message", msg => {
    const roomId = String(msg.room_id || msg.roomId);
    const senderId = Number(msg.sender_id);

    // 좌측 미리보기 업데이트
    const preview = msg.message_type === "image"
      ? "📷 이미지"
      : (msg.message || msg.content || "");
    updateLeftLastMsg(roomId, preview);

    // 1) 현재 보고 있는 방이면
    if (ROOM_ID && roomId === String(ROOM_ID)) {
      // 내가 보낸 거면 무시(중복 렌더 방지)
      if (senderId === CURRENT_USER.id) return;

      renderMsg(msg);
      scrollBottom();

      // ✅ 내가 보고 있는 방에 들어온 메시지는 즉시 읽음 처리
      markRoomAsRead(roomId);

      // (선택) 서버가 상대에게 read 브로드캐스트 하는 구조라면 아래 emit도 유효
      socket.emit("chat:read", { roomId });

      return;
    }

    // 2) 다른 방 메시지면 빨간 점 표시
    showUnreadDot(roomId);
  });

  // ✅ 상대가 읽었다는 이벤트(서버에서 emit 해주는 경우만)
  socket.on("chat:read", payload => {
    const roomId = String(payload?.roomId || payload?.room_id || "");
    if (!ROOM_ID) return;
    if (roomId !== String(ROOM_ID)) return;

    // 내가 보낸 메시지 읽음 표시
    setAllMyMsgsReadUI();
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
   유틸
====================================================== */
function scrollBottom() {
  if (!chatBody) return;
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

    // ✅ 방을 열었으면 무조건 읽음 처리
    markRoomAsRead(ROOM_ID);

    // ✅ 좌측 점 즉시 제거
    hideUnreadDot(ROOM_ID);
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
