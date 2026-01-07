console.log("🔥 chat.js 로딩됨");

const API_URL = "https://blueon.up.railway.app";

/* ======================================================
   URL 파라미터
====================================================== */
const params = new URLSearchParams(location.search);
const ROOM_ID = params.get("room");
const TARGET_ID = params.get("target");

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
  return true;
}

/* ======================================================
   메시지 렌더링 (🔥 최종 수정본)
====================================================== */
function renderMsg(msg) {
  const sender  = msg.senderId ?? msg.sender_id;
  const type    = msg.message_type ?? msg.type ?? "text";
  const content = msg.content ?? msg.message ?? "";
  const fileUrl = msg.file_url ?? null;
  const isRead  = msg.is_read ?? false;

  const wrap = document.createElement("div");
  wrap.className = "msg " + (Number(sender) === Number(CURRENT_USER.id) ? "me" : "other");
  wrap.dataset.messageId = msg.message_id || msg.id;

  // 삭제 버튼 (내 메시지)
  if (Number(sender) === Number(CURRENT_USER.id)) {
    const del = document.createElement("button");
    del.className = "msg-delete-btn";
    del.textContent = "삭제";
    del.onclick = () => deleteMessage(wrap.dataset.messageId);
    wrap.appendChild(del);
  }

  // 🖼 IMAGE
  if (type === "image") {
    if (!fileUrl) {
      console.warn("⚠ image message인데 file_url 없음", msg);
      return;
    }

    const img = document.createElement("img");
    img.src = fileUrl;
    img.style.maxWidth = "180px";
    img.style.borderRadius = "10px";
    img.style.cursor = "pointer";

    img.onclick = () => {
      const modal = document.getElementById("imgModal");
      const modalView = document.getElementById("imgModalView");
      if (modalView) modalView.src = fileUrl;
      if (modal) modal.style.display = "flex";
    };

    wrap.appendChild(img);
  }

  // 📝 TEXT
  else {
    if (!content) return;
    const box = document.createElement("div");
    box.className = "msg-text";
    box.textContent = content;
    wrap.appendChild(box);
  }

  // 읽음 표시
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

  await fetch(`${API_URL}/chat/message/${messageId}`, {
    method: "DELETE",
    credentials: "include"
  }).catch(() => {});
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
  }
}

/* ======================================================
   텍스트 메시지 전송
====================================================== */
async function sendText() {
  const text = msgInput.value.trim();
  if (!text || !ROOM_ID) return;

  const tempId = "temp_" + Date.now();

  renderMsg({
    id: tempId,
    senderId: CURRENT_USER.id,
    message_type: "text",
    content: text
  });

  msgInput.value = "";
  scrollBottom();

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
}

/* ======================================================
   이미지 메시지 전송
====================================================== */
fileBtn?.addEventListener("click", () => fileInput.click());

fileInput?.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  if (!file || !ROOM_ID) return;

  try {
    const form = new FormData();
    form.append("file", file);

    const uploadRes = await fetch(`${API_URL}/chat/upload`, {
      method: "POST",
      credentials: "include",
      body: form
    });

    const uploadData = await uploadRes.json();
    if (!uploadData.success) throw new Error("UPLOAD_FAIL");

    const sendRes = await fetch(`${API_URL}/chat/send-message`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        roomId: ROOM_ID,
        message_type: "image",
        file_url: uploadData.file_url
      })
    });

    const sendData = await sendRes.json();
    if (!sendData.success) throw new Error("SEND_FAIL");

    renderMsg({
      id: sendData.messageId,
      senderId: CURRENT_USER.id,
      message_type: "image",
      content: "📷 이미지",
      file_url: uploadData.file_url
    });

    scrollBottom();

  } catch (e) {
    console.error("❌ 이미지 전송 실패", e);
  } finally {
    fileInput.value = "";
  }
});

/* ======================================================
   소켓 연결 (🔥 API_URL 명시)
====================================================== */
function initSocket(roomId) {
  socket = io(API_URL, {
    path: "/socket.io",
    transports: ["polling"],
    upgrade: false,
    withCredentials: true
  });

  socket.on("connect", () => {
    socket.emit("chat:join", roomId);
  });

  socket.on("chat:message", (msg) => {
    if (String(msg.roomId) !== String(ROOM_ID)) return;
    if (Number(msg.senderId) === Number(CURRENT_USER.id)) return;
    renderMsg(msg);
    scrollBottom();
  });
}

/* ======================================================
   초기 실행
====================================================== */
(async function init() {
  const ok = await loadMe();
  if (!ok) return;

  if (!ROOM_ID && TARGET_ID) {
    const res = await fetch(`${API_URL}/chat/room`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetId: TARGET_ID })
    });
    const data = await safeJson(res);
    if (data.success) {
      location.replace(`/chat.html?room=${data.roomId}&target=${TARGET_ID}`);
      return;
    }
  }

  if (!ROOM_ID) return;

  await loadMessages(ROOM_ID);
  initSocket(ROOM_ID);
})();

/* ======================================================
   이벤트
====================================================== */
sendBtn?.addEventListener("click", sendText);

msgInput?.addEventListener("keydown", e => {
  if (e.key === "Enter") {
    e.preventDefault();
    sendText();
  }
});

document.getElementById("imgModal")?.addEventListener("click", () => {
  document.getElementById("imgModal").style.display = "none";
});
