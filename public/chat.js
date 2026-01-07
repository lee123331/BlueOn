console.log("🔥 chat.js 로딩됨");

const API_URL = "https://blueon.up.railway.app";


/* ======================================================
   URL 파라미터
====================================================== */
const params = new URLSearchParams(location.search);
const ROOM_ID = params.get("room");
const TARGET_ID = params.get("target");
const IS_ROOM_MODE = ROOM_ID && TARGET_ID;

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

/* 🔥 socket 선언만 먼저 */
let socket = null;

/* ======================================================
   전문가 여부 확인
====================================================== */
async function loadIsExpert(userId) {
  try {
    const res  = await fetch(`${API_URL}/expert/profile/${userId}`, {
  credentials: "include"
});

    const data = await res.json();
    return data.success === true;
  } catch {
    return false;
  }
}

/* ======================================================
   로그인 정보
====================================================== */
async function loadMe() {
  const res  = await fetch(`${API_URL}/auth/me`, {
  credentials: "include"
});

  const data = await res.json();
  if (!data.success) return (location.href = "/login.html");

  CURRENT_USER = data.user;
  CURRENT_USER.isExpert = await loadIsExpert(CURRENT_USER.id);

  console.log("🔍 CURRENT_USER =", CURRENT_USER);
}

/* ======================================================
   상대 프로필 로드
====================================================== */
async function loadTargetProfile() {
  if (!TARGET_ID) return;

  let res  = await fetch(`${API_URL}/expert/profile/${TARGET_ID}`, {
  credentials: "include"
});

  let data = await res.json();

  if (data.success) {
    headerImg.src = data.profile.avatar_url || "/assets/default_profile.png";
    headerName.textContent = data.profile.nickname || "전문가";
    return;
  }

  res  = await fetch(`${API_URL}/users/profile/${TARGET_ID}`, {
  credentials: "include"
});

  data = await res.json();

  if (data.success) {
    headerImg.src = data.user.avatar || "/assets/default_profile.png";
    headerName.textContent =
      data.user.nickname || data.user.name || "사용자";
  }
}

/* ======================================================
   메시지 읽음 처리
====================================================== */
async function markRead() {
  if (!ROOM_ID) return;

  fetch(`${API_URL}/chat/read`, {
  method: "POST",
  credentials: "include",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ roomId: ROOM_ID })

});

  if (!socket) return;

  socket.emit("chat:read", {
    roomId: ROOM_ID,
    userId: CURRENT_USER.id
  });
}

/* ======================================================
   메시지 불러오기
====================================================== */
async function loadMessages() {
  if (!ROOM_ID) return;

  const res  = await fetch(`${API_URL}/chat/messages?roomId=${ROOM_ID}`, {
  credentials: "include"
});

  const data = await res.json();

  if (data.success) {
    chatBody.innerHTML = "";
    data.messages.forEach(renderMsg);
    scrollBottom();
    markRead();
  }
}

/* ======================================================
   메시지 렌더링
====================================================== */
function renderMsg(msg) {
  const sender  = msg.senderId      ?? msg.sender_id;
  const type    = msg.message_type  ?? msg.type;
  const content = msg.message       ?? msg.content;
  const isRead  = msg.is_read       ?? false;

  if (!content) return;

  const wrap = document.createElement("div");
  wrap.className = "msg " + (sender === CURRENT_USER.id ? "me" : "other");
  wrap.dataset.messageId = msg.message_id || msg.id;

  /* 삭제 버튼 */
  if (sender === CURRENT_USER.id) {
    const del = document.createElement("button");
    del.className = "msg-delete-btn";
    del.textContent = "삭제";
    del.onclick = () => deleteMessage(wrap.dataset.messageId);
    wrap.appendChild(del);
  }

  /* 이미지 메시지 */
  if (type === "image") {
    const img = document.createElement("img");
    img.src = content;
    img.style.maxWidth = "180px";
    img.style.borderRadius = "10px";
    img.style.cursor = "pointer";

    img.onclick = () => {
      const modal = document.getElementById("imgModal");
      const modalView = document.getElementById("imgModalView");
      modalView.src = content;
      modal.style.display = "flex";
    };

    wrap.appendChild(img);
  }
  /* 텍스트 메시지 */
  else {
    const box = document.createElement("div");
    box.className = "msg-text";
    box.textContent = content;
    wrap.appendChild(box);
  }

  /* 읽음 표시 */
  if (sender === CURRENT_USER.id) {
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
  const element = document.querySelector(
    `[data-message-id='${messageId}']`
  );
  if (element) element.remove();

  try {
    const res = await fetch(`https://blueon.up.railway.app/chat/message/${messageId}`, {
  method: "DELETE",
  credentials: "include",  // 🔥 세션 쿠키 포함해서 보내야 함
  headers: {
    "Content-Type": "application/json"
  }
});

const data = await res.json();


    if (data.success && socket) {
      socket.emit("chat:delete", {
        roomId: ROOM_ID,
        messageId
      });
    }
  } catch (err) {
    console.warn("⚠ DELETE 요청 실패", err);
  }
}

/* ======================================================
   텍스트 메시지 전송
====================================================== */
async function sendText() {
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

const res = await fetch(`https://blueon.up.railway.app/chat/send-message`, {
  method: "POST",
  credentials: "include",   // 🔥 세션 유지 필수
  headers: {
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    roomId: ROOM_ID,
    senderId: CURRENT_USER.id,
    message: text,
    message_type: "text"
  })
});

const data = await res.json();

  if (data.success) {
    const el = document.querySelector(
      `[data-message-id='${tempId}']`
    );
    if (el) el.dataset.messageId = data.messageId;
  }
}

/* ======================================================
   이미지 메시지 전송
====================================================== */
fileBtn.addEventListener("click", () => fileInput.click());

fileInput.addEventListener("change", () => {
  const file = fileInput.files[0];
  if (!file) return;

  const reader = new FileReader();

  reader.onload = async () => {
    const tempId = "temp_" + Date.now();

    renderMsg({
      id      : tempId,
      roomId  : ROOM_ID,
      senderId: CURRENT_USER.id,
      type    : "image",
      content : reader.result
    });

    scrollBottom();

  const res = await fetch(`https://blueon.up.railway.app/chat/send-message`, {
  method: "POST",
  credentials: "include",   // 🔥 세션 유지 필수
  headers: {
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    roomId      : ROOM_ID,
    senderId    : CURRENT_USER.id,
    message     : reader.result,   // base64 이미지 데이터
    message_type: "image"
  })
});

const data = await res.json();

    if (data.success) {
      const el = document.querySelector(
        `[data-message-id='${tempId}']`
      );
      if (el) el.dataset.messageId = data.messageId;
    }

    fileInput.value = "";
  };

  reader.readAsDataURL(file);
});

/* ======================================================
   typing 전송
====================================================== */
msgInput.addEventListener("input", () => {
  if (!socket) return;

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
   스크롤
====================================================== */
function scrollBottom() {
  chatBody.scrollTop = chatBody.scrollHeight;
}

/* ======================================================
   채팅방 목록 로드
====================================================== */
async function loadChatList() {
  try {
    const res = await fetch("https://blueon.up.railway.app/chat/rooms", {
  credentials: "include"
});

    const data = await res.json();

    if (!data.success) return;

    chatListArea.innerHTML = "<h2>메시지</h2>";

    const unreadRes = await fetch("https://blueon.up.railway.app/chat/unread-count", {
  credentials: "include"
});

    const unreadData = await unreadRes.json();
    const UNREAD     = unreadData.rooms || {};

    const MAX_VISIBLE = 5;
    const visibleRooms = data.rooms.slice(0, MAX_VISIBLE);

    visibleRooms.forEach(room => {
      const rid = String(room.room_id);
      const div = document.createElement("div");
      div.className = "chat-item";
      div.dataset.roomId = rid;

      div.onclick = () => {
        const target =
          room.user1_id === CURRENT_USER.id
            ? room.user2_id
            : room.user1_id;

        const badge = div.querySelector(".chat-unread-badge");
        if (badge) badge.style.display = "none";

       fetch(`${API_URL}/chat/read`, {
  method: "POST",
  credentials: "include",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ roomId: rid })
});


        if (socket) {
          socket.emit("chat:read", {
            roomId: rid,
            userId: CURRENT_USER.id
          });
        }

        location.href = `/chat.html?room=${rid}&target=${target}`;
      };

      const avatar = room.other_avatar || "/assets/default_profile.png";

      div.innerHTML = `
        <div class="chat-left">
          <img src="${avatar}">
          <div class="name">${room.other_nickname || "알 수 없음"}</div>
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
   🔥 초기 실행
====================================================== */
(async function init() {
  await loadMe();

socket = io({
  path: "/socket.io",
  transports: ["websocket"],   // 🔥 polling 완전 차단
  withCredentials: true,
  auth: {
    userId: CURRENT_USER.id
  }
});


  socket.on("connect", () => {
    console.log("🔵 소켓 연결됨:", socket.id);
    if (IS_ROOM_MODE) socket.emit("chat:join", ROOM_ID);
  });

  /* ---------- 메시지 수신 ---------- */
  socket.on("chat:message", msg => {
    if (!CURRENT_USER) return;

    if (msg.senderId === CURRENT_USER.id || msg.sender_id === CURRENT_USER.id)
      return;

    const roomId = msg.roomId;

    const item = document.querySelector(
      `.chat-item[data-room-id='${roomId}']`
    );
    if (item) {
      const badge = item.querySelector(".chat-unread-badge");
      if (badge) badge.style.display = "block";
    }

    if (ROOM_ID == roomId) {
      renderMsg(msg);
      scrollBottom();
      markRead();
    }
  });

  /* ---------- 메시지 삭제 ---------- */
  socket.on("chat:delete", ({ messageId }) => {
    const el = document.querySelector(`[data-message-id='${messageId}']`);
    if (el) el.remove();
  });

  /* ---------- typing 표시 수신 ---------- */
  socket.on("chat:typing", ({ roomId, userId, isTyping }) => {
    if (!ROOM_ID) return;
    if (ROOM_ID != roomId) return;
    if (userId === CURRENT_USER.id) return;

    typingIndicator.style.display = isTyping ? "block" : "none";
  });

  /* ---------- 읽음 표시 수신 (🔥 신규 추가) ---------- */
  socket.on("chat:read", ({ roomId, userId }) => {
    if (ROOM_ID != roomId) return;

    const myMessages = document.querySelectorAll(".msg.me .read-state");
    myMessages.forEach(state => {
      state.textContent = "읽음";
    });
  });

  /* ---------- notify 수신 ---------- */
  socket.on("chat:notify", async ({ targetId, roomId }) => {
    if (targetId != CURRENT_USER.id) return;

    await loadChatList();
    if (ROOM_ID == roomId) {
      await loadMessages();
    }

    const alertBox = document.getElementById("globalChatAlert");
    if (alertBox) {
      alertBox.style.display = "block";
      alertBox.style.opacity = "1";

      setTimeout(() => {
        alertBox.style.opacity = "0";
        setTimeout(() => (alertBox.style.display = "none"), 300);
      }, 2500);
    }
  });

  await loadChatList();

  if (IS_ROOM_MODE) {
    await loadTargetProfile();
    await loadMessages();

    if (CURRENT_USER.isExpert === true) {
      const btn = document.getElementById("viewBrandPlanBtn");
      if (btn) {
        btn.style.display = "inline-block";
        btn.onclick = () =>
          (location.href = `brand-plan-view.html?user=${TARGET_ID}`);
      }
    }
  } else {
    document.querySelector(".chat-header").style.display = "none";
    chatBody.innerHTML =
      "<div style='padding:20px;color:#6b7280;'>대화를 선택하세요.</div>";
  }
})();

/* ======================================================
   전송 버튼 / 엔터키
====================================================== */
sendBtn.addEventListener("click", sendText);

msgInput.addEventListener("keydown", e => {
  if (e.key === "Enter") {
    e.preventDefault();
    sendText();
  }
});

/* ======================================================
   이미지 모달 닫기
====================================================== */
document.getElementById("imgModal").addEventListener("click", () => {
  document.getElementById("imgModal").style.display = "none";
});
