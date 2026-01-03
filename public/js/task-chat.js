/* ======================================================
   BlueOn 작업 전용 채팅 (최종 안정화 버전)
====================================================== */
(() => {
  const API = "https://blueon.up.railway.app";

  /* ===============================
     DOM
  ============================== */
  const chatBox   = document.getElementById("chatMessages");
  const msgInput  = document.getElementById("chatInput");
  const sendBtn   = document.getElementById("sendBtn");
  const attachBtn = document.getElementById("attachBtn");
  const fileInput = document.getElementById("fileInput");

  const serviceTitleEl = document.getElementById("serviceTitle");
  const buyerNameEl    = document.getElementById("buyerName");

  /* ===============================
     URL
  ============================== */
  const taskKey = new URLSearchParams(location.search).get("taskKey");
  if (!taskKey) {
    alert("잘못된 접근입니다.");
    return;
  }

  /* ===============================
     상태
  ============================== */
  let ctx = null;
  let socket = null;
  const renderedIds = new Set();

  /* ===============================
     유틸
  ============================== */
  const escapeHTML = (str) =>
    String(str).replace(/[&<>"']/g, (m) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    }[m]));

  const scrollBottom = () => {
    chatBox.scrollTop = chatBox.scrollHeight;
  };

  async function fetchJSON(url, options = {}) {
    const res = await fetch(url, { credentials: "include", ...options });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.success === false) {
      throw new Error(data.message || "요청 실패");
    }
    return data;
  }

  /* ===============================
     메시지 렌더
  ============================== */
  function renderMessage(msg) {
    if (!msg || renderedIds.has(msg.id)) return;
    renderedIds.add(msg.id);

    const isMine = msg.sender_id === ctx.myId;

    const wrap = document.createElement("div");
    wrap.className = "msg" + (isMine ? " me" : "");
    wrap.dataset.id = msg.id;

    const bubble = document.createElement("div");
    bubble.className = "bubble";

    if (msg.deleted) {
      bubble.innerHTML = `<em>삭제된 메시지입니다.</em>`;
    } else if (msg.type === "file") {
      bubble.innerHTML = `
        <a href="${msg.file_url}" target="_blank">
          📁 ${escapeHTML(msg.file_name)}
        </a>
        <div class="time">${new Date(msg.created_at).toLocaleString()}</div>
      `;
    } else {
      bubble.innerHTML = `
        <div>${escapeHTML(msg.message)}</div>
        <div class="time">
          ${new Date(msg.created_at).toLocaleString()}
          ${isMine && msg.is_read ? " ✔✔" : ""}
        </div>
      `;
    }

    if (isMine && !msg.deleted) {
      const delBtn = document.createElement("button");
      delBtn.className = "msg-delete-btn";
      delBtn.innerText = "삭제";
      delBtn.onclick = () => deleteMessage(msg.id);
      bubble.appendChild(delBtn);
    }

    wrap.appendChild(bubble);
    chatBox.appendChild(wrap);
    scrollBottom();
  }

  /* ===============================
     컨텍스트
  ============================== */
  async function loadContext() {
    const data = await fetchJSON(
      `${API}/api/task-chat/context?taskKey=${encodeURIComponent(taskKey)}`
    );
    ctx = data.context;

    serviceTitleEl.innerText = ctx.serviceTitle || "서비스";
    buyerNameEl.innerText =
      ctx.buyer?.nickname || ctx.buyer_nickname || "의뢰인";
  }

  /* ===============================
     메시지 로드
  ============================== */
  async function loadMessages() {
    const data = await fetchJSON(
      `${API}/api/task-chat/messages?roomId=${ctx.roomId}`
    );

    chatBox.innerHTML = "";
    renderedIds.clear();

    data.messages.forEach(renderMessage);
    await markAsRead();
  }

  async function markAsRead() {
    await fetchJSON(`${API}/api/task-chat/read`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roomId: ctx.roomId }),
    });
  }

  async function deleteMessage(messageId) {
    if (!confirm("메시지를 삭제할까요?")) return;

    await fetchJSON(`${API}/api/task-chat/delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messageId }),
    });
  }

  /* ===============================
     Socket.io (🔥 핵심 수정)
  ============================== */
  function connectSocket(){
  socket = io(`${API}/task`, {
    withCredentials: true,
    transports: ["websocket"] // 🔥 polling 완전 차단
  });

  socket.on("connect", () => {
    socket.emit("task:join", { roomId: ctx.roomId });
  });

  socket.on("task:new", msg => {
    if (String(msg.roomId) !== String(ctx.roomId)) return;
    renderMessage(msg);
    markRead();
  });

  socket.on("task:read", () => {
    document.querySelectorAll(".msg.me .time").forEach(t => {
      if (!t.innerText.includes("✔✔")) t.innerText += " ✔✔";
    });
  });

  socket.on("connect_error", err => {
    console.error("❌ socket error:", err);
  });
}


  /* ===============================
   전송 (수정 완료)
============================== */
function sendMessage() {
  const text = msgInput.value.trim();
  if (!text || !socket || !ctx) return;

  // 🔥 1. 즉시 화면에 표시 (임시 메시지)
  const tempMsg = {
    id: "temp-" + Date.now(),
    sender_id: ctx.myId,
    message: text,
    created_at: new Date().toISOString(),
    is_read: false
  };
  renderMessage(tempMsg);

  msgInput.value = "";

  // 🔥 2. 서버 전송
  socket.emit("task:send", {
    taskKey,
    roomId: ctx.roomId,
    message: text
  });
}

/* ===============================
   파일 전송
============================== */
async function sendFile(file) {
  if (!file || !ctx) return;

  const fd = new FormData();
  fd.append("file", file);
  fd.append("taskKey", taskKey);

  const data = await fetchJSON(`${API}/api/task-chat/upload`, {
    method: "POST",
    body: fd
  });

  // 🔥 즉시 렌더
  renderMessage({
    id: "temp-file-" + Date.now(),
    sender_id: ctx.myId,
    type: "file",
    file_url: data.file.file_url,
    file_name: data.file.file_name,
    created_at: new Date().toISOString()
  });

  socket.emit("task:file", {
    roomId: ctx.roomId,
    ...data.file
  });
}

/* ===============================
   이벤트 바인딩
============================== */
sendBtn.addEventListener("click", sendMessage);

// ✅ 엔터 전송 (Shift+Enter 줄바꿈)
msgInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

attachBtn.onclick = () => fileInput.click();
fileInput.onchange = () => {
  if (fileInput.files[0]) sendFile(fileInput.files[0]);
  fileInput.value = "";
};


  /* ===============================
     시작
  ============================== */
  (async () => {
    try {
      await loadContext();
      await loadMessages();
      connectSocket();

      msgInput.disabled = false;
      sendBtn.disabled = false;
      msgInput.focus();
    } catch (err) {
      console.error(err);
      alert(err.message || "채팅을 불러올 수 없습니다.");
    }
  })();
})();
