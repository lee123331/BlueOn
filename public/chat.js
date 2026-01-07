console.log("🔥 chat.js 로딩됨");

const API_URL = "https://blueon.up.railway.app";

/* ======================================================
   URL 파라미터
====================================================== */
const params = new URLSearchParams(location.search);
const ROOM_ID = params.get("room");
const TARGET_ID = params.get("target");

console.log("🔍 ROOM_ID =", ROOM_ID);
console.log("🔍 TARGET_ID =", TARGET_ID);

/* ======================================================
   DOM 요소
====================================================== */
const chatBody        = document.getElementById("chatBody");
const msgInput        = document.getElementById("msgInput");
const sendBtn         = document.getElementById("sendBtn");
const fileBtn         = document.getElementById("fileBtn");
const fileInput       = document.getElementById("fileInput");
const chatListArea    = document.getElementById("chatList");
const headerImg       = document.getElementById("chatProfileImg");
const headerName      = document.getElementById("chatProfileName");
const typingIndicator = document.getElementById("typingIndicator");

let CURRENT_USER = null;
let typingTimer  = null;
let socket = null;

/* ======================================================
   유틸
====================================================== */
async function safeJson(res) {
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("application/json")) {
    const txt = await res.text().catch(() => "");
    throw new Error(`JSON 아님. status=${res.status} body=${txt.slice(0, 120)}`);
  }
  return res.json();
}

function scrollBottom() {
  chatBody.scrollTop = chatBody.scrollHeight;
}

function setEmptyState(text = "대화를 선택해주세요") {
  headerName.textContent = "채팅";
  headerImg.src = "/assets/default_profile.png";
  chatBody.innerHTML = `<div class="chat-empty">${text}</div>`;
}

/* ======================================================
   전문가 여부 확인
====================================================== */
async function loadIsExpert(userId) {
  try {
    const res = await fetch(`${API_URL}/expert/profile/${userId}`, {
      credentials: "include",
      cache: "no-store",
    });
    const data = await safeJson(res);
    return data.success === true;
  } catch {
    return false;
  }
}

/* ======================================================
   로그인 정보
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
  CURRENT_USER.isExpert = await loadIsExpert(CURRENT_USER.id);

  console.log("🔍 CURRENT_USER =", CURRENT_USER);
  return true;
}

/* ======================================================
   상대 프로필 로드
====================================================== */
async function loadTargetProfile() {
  if (!TARGET_ID) return;

  // 1) 전문가 프로필 우선
  try {
    let res = await fetch(`${API_URL}/expert/profile/${TARGET_ID}`, {
      credentials: "include",
      cache: "no-store",
    });
    let data = await safeJson(res);

    if (data.success && data.profile) {
      headerImg.src = data.profile.avatar_url || "/assets/default_profile.png";
      headerName.textContent = data.profile.nickname || "전문가";
      return;
    }
  } catch {}

  // 2) 일반 유저 프로필
  try {
    const res = await fetch(`${API_URL}/users/profile/${TARGET_ID}`, {
      credentials: "include",
      cache: "no-store",
    });
    const data = await safeJson(res);

    if (data.success && data.user) {
      headerImg.src = data.user.avatar_url || data.user.avatar || "/assets/default_profile.png";
      headerName.textContent = data.user.nickname || data.user.name || "사용자";
    }
  } catch {}
}

/* ======================================================
   메시지 읽음 처리
====================================================== */
async function markRead(roomId = ROOM_ID) {
  if (!roomId) return;

  fetch(`${API_URL}/chat/read`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ roomId })
  }).catch(() => {});

  if (socket) {
    socket.emit("chat:read", {
      roomId,
      userId: CURRENT_USER.id
    });
  }
}

/* ======================================================
   메시지 렌더링
====================================================== */
function renderMsg(msg) {
  const sender  = msg.senderId ?? msg.sender_id;
  const type    = msg.message_type ?? msg.type ?? "text";
  const content = msg.message ?? msg.content;
  const isRead  = msg.is_read ?? false;

  if (!content) return;

  const wrap = document.createElement("div");
  wrap.className = "msg " + (Number(sender) === Number(CURRENT_USER.id) ? "me" : "other");
  wrap.dataset.messageId = msg.message_id || msg.id;

  // 삭제 버튼 (내 메시지만)
  if (Number(sender) === Number(CURRENT_USER.id)) {
    const del = document.createElement("button");
    del.className = "msg-delete-btn";
    del.textContent = "삭제";
    del.onclick = () => deleteMessage(wrap.dataset.messageId);
    wrap.appendChild(del);
  }

  if (type === "image") {
    const img = document.createElement("img");
    img.src = content;
    img.style.maxWidth = "180px";
    img.style.borderRadius = "10px";
    img.style.cursor = "pointer";

    img.onclick = () => {
      const modal = document.getElementById("imgModal");
      const modalView = document.getElementById("imgModalView");
      if (modalView) modalView.src = content;
      if (modal) modal.style.display = "flex";
    };

    wrap.appendChild(img);
  } else {
    const box = document.createElement("div");
    box.className = "msg-text";
    box.textContent = content;
    wrap.appendChild(box);
  }

  // 읽음 표시(내 메시지)
  if (Number(sender) === Number(CURRENT_USER.id)) {
    const readEl = document.createElement("div");
    readEl.className = "read-state";
    readEl.textContent = isRead ? "읽음" : "";
    wrap.appendChild(readEl);
  }

  chatBody.appendChild(wrap);
}

/* ======================================================
   메시지 삭제
====================================================== */
async function deleteMessage(messageId) {
  const el = document.querySelector(`[data-message-id='${messageId}']`);
  if (el) el.remove();

  try {
    const res = await fetch(`${API_URL}/chat/message/${messageId}`, {
      method: "DELETE",
      credentials: "include",
      headers: { "Content-Type": "application/json" }
    });
    const data = await safeJson(res);

    if (data.success && socket && ROOM_ID) {
      socket.emit("chat:delete", {
        roomId: ROOM_ID,
        messageId
      });
    }
  } catch (err) {
    console.warn("⚠ DELETE 실패:", err);
  }
}

/* ======================================================
   메시지 불러오기
====================================================== */
async function loadMessages(roomId = ROOM_ID) {
  if (!roomId) return;

  const res = await fetch(`${API_URL}/chat/messages?roomId=${encodeURIComponent(roomId)}`, {
    credentials: "include",
    cache: "no-store",
  });
  const data = await safeJson(res);

  if (data.success) {
    chatBody.innerHTML = "";
    data.messages.forEach(renderMsg);
    scrollBottom();
    markRead(roomId);
  } else {
    chatBody.innerHTML = "";
    setEmptyState("메시지를 불러올 수 없습니다.");
  }
}

/* ======================================================
   텍스트 메시지 전송
====================================================== */
async function sendText() {
  if (!ROOM_ID) return;
  const text = msgInput.value.trim();
  if (!text) return;

  const tempId = "temp_" + Date.now();

  renderMsg({
    id      : tempId,
    roomId  : ROOM_ID,
    senderId: CURRENT_USER.id,
    type    : "text",
    content : text
  });

  scrollBottom();
  msgInput.value = "";

  try {
    const res = await fetch(`${API_URL}/chat/send-message`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        roomId: ROOM_ID,
        message: text,
        message_type: "text"
      })
    });

    const data = await safeJson(res);

    if (data.success) {
      const el = document.querySelector(`[data-message-id='${tempId}']`);
      if (el) el.dataset.messageId = data.messageId;
    }
  } catch (err) {
    console.error("❌ sendText 실패:", err);
  }
}


/* ======================================================
   이미지 메시지 전송 (정상 구조: FormData + 파일 업로드)
====================================================== */
if (fileBtn && fileInput) {
  fileBtn.addEventListener("click", () => fileInput.click());

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    if (!file || !ROOM_ID) return;

    try {
      /* ===========================
         1️⃣ 이미지 업로드
      =========================== */
      const form = new FormData();
      form.append("file", file);

      const uploadRes = await fetch(`${API_URL}/chat/upload`, {
        method: "POST",
        credentials: "include",
        body: form
      });

      const uploadData = await uploadRes.json();
      if (!uploadData.success) throw new Error("UPLOAD_FAIL");

      /* ===========================
         2️⃣ 채팅 메시지 전송
      =========================== */
      const sendRes = await fetch(`${API_URL}/chat/send-message`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roomId: ROOM_ID,
          message_type: "image",
          content: uploadData.file_url
        })
      });

      const sendData = await sendRes.json();
      if (!sendData.success) throw new Error("SEND_FAIL");

      /* ===========================
         3️⃣ 즉시 렌더링
      =========================== */
      renderMsg({
        id: sendData.messageId,
        roomId: ROOM_ID,
        senderId: CURRENT_USER.id,
        type: "image",
        content: uploadData.file_url
      });

      scrollBottom();

    } catch (err) {
      console.error("❌ 이미지 전송 실패:", err);
      alert("이미지 전송 실패");
    } finally {
      fileInput.value = "";
    }
  });
}

/* ======================================================
   typing 전송
====================================================== */
msgInput?.addEventListener("input", () => {
  if (!socket || !ROOM_ID) return;

  socket.emit("chat:typing", {
    roomId  : ROOM_ID,
    userId  : CURRENT_USER.id,
    isTyping: true
  });

  clearTimeout(typingTimer);
  typingTimer = setTimeout(() => {
    socket.emit("chat:typing", {
      roomId  : ROOM_ID,
      userId  : CURRENT_USER.id,
      isTyping: false
    });
  }, 800);
});

/* ======================================================
   채팅방 목록 로드 (✅ 중복 제거 + other_id만 사용)
====================================================== */
async function loadChatList() {
  try {
    const res = await fetch(`${API_URL}/chat/rooms`, {
      credentials: "include",
      cache: "no-store",
    });
    const data = await safeJson(res);

    if (!data.success) return;

    chatListArea.innerHTML = "<h2>메시지</h2>";

    // unread
    let UNREAD = {};
    try {
      const unreadRes = await fetch(`${API_URL}/chat/unread-count`, {
        credentials: "include",
        cache: "no-store",
      });
      const unreadData = await safeJson(unreadRes);
      UNREAD = unreadData.rooms || {};
    } catch {}

    // ✅ 중복 방 제거(혹시 서버가 중복 내려줘도 안전)
    const unique = [];
    const seen = new Set();
    for (const r of (data.rooms || [])) {
      const key = String(r.room_id);
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(r);
    }

    const MAX_VISIBLE = 5;
    const visibleRooms = unique.slice(0, MAX_VISIBLE);

    visibleRooms.forEach(room => {
      const rid = String(room.room_id);

      const div = document.createElement("div");
      div.className = "chat-item";
      div.dataset.roomId = rid;

      div.onclick = async () => {
        const target = room.other_id; // ✅ 무조건 서버값

        const badge = div.querySelector(".chat-unread-badge");
        if (badge) badge.style.display = "none";

        await markRead(rid);

        location.href = `/chat.html?room=${rid}&target=${target}`;
      };

      const avatar = room.other_avatar || "/assets/default_profile.png";
      const name   = room.other_nickname || "알 수 없음";

      div.innerHTML = `
        <div class="chat-left">
          <img src="${avatar}">
          <div class="name">${name}</div>
        </div>
        <div class="chat-unread-badge"
             style="display:${UNREAD[rid] > 0 ? "block" : "none"};"></div>
      `;

      chatListArea.appendChild(div);
    });

  } catch (err) {
    console.error("❌ loadChatList() 오류:", err);
  }
}

/* ======================================================
   소켓 연결 (room 모드에서만)
====================================================== */
function initSocket(roomId) {
  socket = io({
    path: "/socket.io",
    transports: ["polling"],   // ✅ Railway에서 안정적
    upgrade: false,
    withCredentials: true
  });

  socket.on("connect", () => {
    console.log("🔵 socket connected:", socket.id);
    socket.emit("chat:join", roomId);
  });

  socket.on("connect_error", (e) => {
    console.warn("⚠ socket connect_error:", e?.message || e);
  });

  // 메시지 수신
  socket.on("chat:message", (msg) => {
    if (!CURRENT_USER) return;

    const senderId = msg.senderId ?? msg.sender_id;
    const roomId   = String(msg.roomId ?? msg.room_id);

    // 왼쪽 목록 배지
    const item = document.querySelector(`.chat-item[data-room-id='${roomId}']`);
    if (item && Number(senderId) !== Number(CURRENT_USER.id)) {
      const badge = item.querySelector(".chat-unread-badge");
      if (badge) badge.style.display = "block";
    }

    // 현재 방이면 그려주기
    if (String(ROOM_ID) === String(roomId)) {
      // 내가 보낸 메시지는 서버에서 다시 와도 무시(중복 방지)
      if (Number(senderId) === Number(CURRENT_USER.id)) return;
      renderMsg(msg);
      scrollBottom();
      markRead(roomId);
    }
  });

  // 메시지 삭제
  socket.on("chat:delete", ({ messageId }) => {
    const el = document.querySelector(`[data-message-id='${messageId}']`);
    if (el) el.remove();
  });

  // typing
  socket.on("chat:typing", ({ roomId, userId, isTyping }) => {
    if (String(ROOM_ID) !== String(roomId)) return;
    if (Number(userId) === Number(CURRENT_USER.id)) return;
    if (typingIndicator) typingIndicator.style.display = isTyping ? "block" : "none";
  });

  // 읽음
  socket.on("chat:read", ({ roomId }) => {
    if (String(ROOM_ID) !== String(roomId)) return;
    document.querySelectorAll(".msg.me .read-state")
      .forEach(el => (el.textContent = "읽음"));
  });
}

/* ======================================================
   초기 실행
====================================================== */
(async function init() {
  const ok = await loadMe();
  if (!ok) return;

  // 1) 문의하기 루트: room 생성
  if (!ROOM_ID && TARGET_ID) {
    try {
      const res = await fetch(`${API_URL}/chat/room`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetId: TARGET_ID })
      });
      const data = await safeJson(res);
      if (data.success && data.roomId) {
        location.replace(`/chat.html?room=${data.roomId}&target=${TARGET_ID}`);
        return;
      }
    } catch (e) {
      console.error("❌ chat/room 생성 실패:", e);
      setEmptyState("채팅방 생성에 실패했습니다.");
      return;
    }
  }

  // 2) 메인 채팅 리스트 루트
  if (!ROOM_ID && !TARGET_ID) {
    await loadChatList();
    setEmptyState("대화를 선택해주세요");
    return; // ✅ socket 연결 안함
  }

  // 3) 특정 채팅방 루트
  await loadTargetProfile();
  await loadChatList();
  await loadMessages(ROOM_ID);

  initSocket(ROOM_ID);
})();

/* ======================================================
   전송 버튼 / 엔터키
====================================================== */
sendBtn?.addEventListener("click", sendText);

msgInput?.addEventListener("keydown", e => {
  if (e.key === "Enter") {
    e.preventDefault();
    sendText();
  }
});

/* ======================================================
   이미지 모달 닫기
====================================================== */
document.getElementById("imgModal")?.addEventListener("click", () => {
  const modal = document.getElementById("imgModal");
  if (modal) modal.style.display = "none";
});
