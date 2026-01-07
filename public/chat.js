// chat.js (최종 안정판)  ✅ 중복렌더 제거 ✅ 헤더/프로필 정상 ✅ 읽음표시(마지막만) ✅ 삭제기능 ✅ 배지 동기화
console.log("🔥 chat.js loaded");

const API_URL = "https://blueon.up.railway.app";

/* ======================================================
   URL
====================================================== */
const params = new URLSearchParams(location.search);
let ROOM_ID = params.get("room");

/* ======================================================
   DOM
====================================================== */
const chatBody     = document.getElementById("chatBody");
const msgInput     = document.getElementById("msgInput");
const sendBtn      = document.getElementById("sendBtn");
const fileBtn      = document.getElementById("fileBtn");
const fileInput    = document.getElementById("fileInput");
const chatListArea = document.getElementById("chatList");
const headerImg    = document.getElementById("chatProfileImg");
const headerName   = document.getElementById("chatProfileName");

let CURRENT_USER = null;
let socket = null;

/* ======================================================
   Utils
====================================================== */
async function safeJson(res) {
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("application/json")) {
    const t = await res.text().catch(() => "");
    throw new Error(`JSON 아님: ${t.slice(0, 120)}`);
  }
  return res.json();
}

function scrollBottom() {
  chatBody.scrollTop = chatBody.scrollHeight;
}

function setHeader(nickname, avatar) {
  headerName.textContent = nickname || "상대방";
  headerImg.src = avatar || "/assets/default_profile.png";
}

function setEmpty(text) {
  chatBody.innerHTML = `<div style="padding:20px;color:#6b7280;">${text}</div>`;
}

/* ======================================================
   로그인
====================================================== */
async function loadMe() {
  const res = await fetch(`${API_URL}/auth/me`, {
    credentials: "include",
    cache: "no-store",
  });
  const data = await safeJson(res);

  if (!data.success) {
    location.href = "/login.html";
    return false;
  }

  CURRENT_USER = data.user;
  return true;
}

/* ======================================================
   채팅 목록 (좌측)
====================================================== */
async function loadChatList() {
  const res = await fetch(`${API_URL}/chat/rooms`, {
    credentials: "include",
    cache: "no-store",
  });
  const data = await safeJson(res);

  chatListArea.innerHTML = "<h2>메시지</h2>";
  if (!data.success || !Array.isArray(data.rooms)) return null;

  data.rooms.forEach((room) => {
    const div = document.createElement("div");
    div.className = "chat-item";
    div.dataset.roomId = room.room_id;
    div.dataset.nickname = room.other_nickname || "상대방";
    div.dataset.avatar = room.other_avatar || "/assets/default_profile.png";

    div.innerHTML = `
      <div class="chat-left">
        <img src="${div.dataset.avatar}">
        <div>${div.dataset.nickname}</div>
      </div>
      <div class="chat-unread-badge"></div>
    `;

    div.onclick = () => {
      location.href = `/chat.html?room=${room.room_id}`;
    };

    if (ROOM_ID && String(room.room_id) === String(ROOM_ID)) {
      div.style.background = "#eef2ff";
    }

    // (옵션) 서버가 unread_count 내려주면 표시
    if (room.unread_count && Number(room.unread_count) > 0) {
      const badge = div.querySelector(".chat-unread-badge");
      badge.style.display = "block";
      badge.textContent = ""; // 점만 보이게 유지(숫자로 바꾸고 싶으면 room.unread_count 넣기)
    }

    chatListArea.appendChild(div);
  });

  return data.rooms[0] || null;
}

/* ======================================================
   헤더 프로필 (room 기준)
====================================================== */
async function setHeaderByRoomId(roomId) {
  // 1) 이미 그려진 목록에서 찾기 (가장 안정)
  const item = document.querySelector(`.chat-item[data-room-id='${roomId}']`);
  if (item) {
    setHeader(item.dataset.nickname, item.dataset.avatar);
    return;
  }

  // 2) 목록 재조회 fallback
  try {
    const res = await fetch(`${API_URL}/chat/rooms`, {
      credentials: "include",
      cache: "no-store",
    });
    const data = await res.json();

    if (data.success && Array.isArray(data.rooms)) {
      const r = data.rooms.find((x) => String(x.room_id) === String(roomId));
      if (r) {
        setHeader(r.other_nickname, r.other_avatar);
        return;
      }
    }
  } catch {}

  // 3) 최후 fallback
  setHeader("상대방", "/assets/default_profile.png");
}

/* ======================================================
   메시지 렌더
====================================================== */
function renderMsg(msg) {
  const sender = msg.sender_id ?? msg.senderId;
  const isMe = Number(sender) === Number(CURRENT_USER.id);

  const wrap = document.createElement("div");
  wrap.className = "msg " + (isMe ? "me" : "other");

  const messageId = msg.id || msg.message_id;
  if (messageId) wrap.dataset.messageId = String(messageId);

  if (msg.message_type === "image") {
    const img = document.createElement("img");
    img.src = msg.file_url;
    img.style.maxWidth = "180px";
    img.style.borderRadius = "10px";
    img.onclick = () => {
      const v = document.getElementById("imgModalView");
      const m = document.getElementById("imgModal");
      if (v && m) {
        v.src = img.src;
        m.style.display = "flex";
      }
    };
    wrap.appendChild(img);
  } else {
    wrap.textContent = msg.message ?? msg.content ?? "";
  }

  // ✅ 내 메시지에만 삭제 버튼 + read-state
  if (isMe && messageId) {
    const del = document.createElement("button");
    del.className = "msg-delete-btn";
    del.type = "button";
    del.textContent = "삭제";
    del.onclick = () => deleteMessage(messageId);
    wrap.appendChild(del);

    const read = document.createElement("div");
    read.className = "read-state";
    read.textContent = "";
    wrap.appendChild(read);
  }

  chatBody.appendChild(wrap);
}

/* ======================================================
   메시지 로드 + 읽음
====================================================== */
async function loadMessages(roomId) {
  const res = await fetch(`${API_URL}/chat/messages?roomId=${roomId}`, {
    credentials: "include",
    cache: "no-store",
  });
  const data = await safeJson(res);
  if (!data.success) return;

  chatBody.innerHTML = "";
  data.messages.forEach(renderMsg);
  scrollBottom();

  // ✅ 읽음 처리(서버 unread 삭제)
  await markRead(roomId);
}

/* ======================================================
   읽음 처리 (서버 unread 삭제 + 헤더 배지 갱신)
====================================================== */
async function markRead(roomId) {
  if (!roomId) return;

  await fetch(`${API_URL}/chat/read`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ roomId }),
  }).catch(() => {});

  // 헤더 배지 즉시 갱신
  window.refreshHeaderBadge?.();

  // (옵션) 상대에게 읽음 알림(표시용)
  socket?.emit("chat:read", {
    roomId,
    userId: CURRENT_USER?.id,
  });
}

/* ======================================================
   메시지 전송  ✅(중복렌더 방지: 서버 socket만 렌더링)
====================================================== */
async function sendText() {
  const text = msgInput.value.trim();
  if (!text || !ROOM_ID) return;

  msgInput.value = "";

  await fetch(`${API_URL}/chat/send-message`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      roomId: ROOM_ID,
      message: text,
      message_type: "text",
    }),
  }).catch(() => {});
}

/* ======================================================
   이미지 업로드 → send-message
====================================================== */
fileBtn?.addEventListener("click", () => fileInput.click());

fileInput?.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  if (!file || !ROOM_ID) return;

  const form = new FormData();
  form.append("file", file);

  const uploadRes = await fetch(`${API_URL}/chat/upload`, {
    method: "POST",
    credentials: "include",
    body: form,
  });

  const uploadData = await uploadRes.json().catch(() => ({}));
  if (!uploadData.success) return;

  await fetch(`${API_URL}/chat/send-message`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      roomId: ROOM_ID,
      message_type: "image",
      file_url: uploadData.file_url,
    }),
  }).catch(() => {});
});

/* ======================================================
   메시지 삭제 (DB + socket)
   - 서버에 /chat/delete 라우트가 있어야 함
====================================================== */
async function deleteMessage(messageId) {
  if (!messageId) return;

  await fetch(`${API_URL}/chat/delete`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messageId }),
  }).catch(() => {});

  // 나 포함 방 전체에서 제거
  socket?.emit("chat:delete", { roomId: ROOM_ID, messageId });

  document.querySelector(`.msg[data-message-id='${messageId}']`)?.remove();
}

/* ======================================================
   Socket
====================================================== */
function initSocket(roomId) {
  socket = io(API_URL, { withCredentials: true });

  socket.on("connect", () => {
    socket.emit("chat:join", String(roomId));
  });

  // ✅ 서버에서 브로드캐스트된 메시지 수신
  socket.on("chat:message", (msg) => {
    if (String(msg.roomId) !== String(ROOM_ID)) return;

    // 🔥 내 메시지도 서버가 보내주므로 그대로 렌더링(중복 없음: 프론트 즉시렌더 제거했기 때문)
    renderMsg(msg);
    scrollBottom();

    // 상대 메시지면 읽음 처리
    const sender = msg.sender_id ?? msg.senderId;
    if (Number(sender) !== Number(CURRENT_USER.id)) {
      markRead(ROOM_ID);
    }
  });

  // ✅ 읽음 표시: "마지막 내 메시지 하나만" 읽음
  socket.on("chat:read", ({ roomId }) => {
    if (String(roomId) !== String(ROOM_ID)) return;

    const reads = document.querySelectorAll(".msg.me .read-state");
    reads.forEach((el) => (el.textContent = ""));
    reads[reads.length - 1]?.textContent = "읽음";
  });

  socket.on("chat:delete", ({ messageId }) => {
    document.querySelector(`.msg[data-message-id='${messageId}']`)?.remove();
  });

  socket.on("connect_error", (err) => {
    console.warn("⚠️ socket connect_error", err?.message || err);
  });
}

/* ======================================================
   INIT
====================================================== */
(async function init() {
  const ok = await loadMe();
  if (!ok) return;

  const firstRoom = await loadChatList();

  if (!ROOM_ID && firstRoom) {
    location.replace(`/chat.html?room=${firstRoom.room_id}`);
    return;
  }

  if (!ROOM_ID) {
    setEmpty("대화를 시작해보세요");
    return;
  }

  initSocket(ROOM_ID);

  // ✅ 목록 그린 뒤 헤더 세팅
  await setHeaderByRoomId(ROOM_ID);

  // ✅ 메시지 로드 후 읽음 처리
  await loadMessages(ROOM_ID);
})();

/* ======================================================
   Events
====================================================== */
sendBtn?.addEventListener("click", sendText);

msgInput?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    sendText();
  }
});

// 이미지 모달 닫기
document.getElementById("imgModal")?.addEventListener("click", () => {
  const m = document.getElementById("imgModal");
  if (m) m.style.display = "none";
});
