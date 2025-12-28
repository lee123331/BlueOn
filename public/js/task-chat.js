/* ======================================================
   BlueOn 작업 전용 채팅
   file: public/js/task-chat.js
   기준: taskKey (서버가 항상 진실)
====================================================== */

(() => {
  const API = "https://blueon.up.railway.app";

  /* ===============================
     DOM
  ============================== */
  const chatBox   = document.getElementById("chatBox");
  const msgInput  = document.getElementById("msgInput");
  const sendBtn   = document.getElementById("sendBtn");
  const metaText  = document.getElementById("metaText");

  /* ===============================
     URL 파라미터
  ============================== */
  const taskKey = new URLSearchParams(location.search).get("taskKey");

  if (!taskKey) {
    alert("잘못된 접근입니다.");
    location.href = "/";
    return;
  }

  /* ===============================
     상태 값
  ============================== */
  let ctx = null;        // 서버에서 받은 context
  let socket = null;    // task namespace socket

  /* ===============================
     유틸
  ============================== */
  function escapeHTML(str) {
    return String(str)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function scrollBottom() {
    chatBox.scrollTop = chatBox.scrollHeight;
  }

  /* ===============================
     메시지 렌더
  ============================== */
  function renderMessage(msg) {
    const isMine = msg.sender_id === ctx.myId || msg.senderId === ctx.myId;

    const wrap = document.createElement("div");
    wrap.className = "msg" + (isMine ? " me" : "");

    const bubble = document.createElement("div");
    bubble.className = "bubble";

    bubble.innerHTML = `
      <div>${escapeHTML(msg.message)}</div>
      <div class="time">
        ${new Date(msg.created_at).toLocaleString()}
      </div>
    `;

    wrap.appendChild(bubble);
    chatBox.appendChild(wrap);
    scrollBottom();
  }

  /* ===============================
     서버 API
  ============================== */
  async function fetchJSON(url) {
    const res = await fetch(url, { credentials: "include" });
    const data = await res.json().catch(() => ({}));

    if (!res.ok || data.success === false) {
      throw new Error(data.message || "요청 실패");
    }
    return data;
  }

  /* ===============================
     1️⃣ 컨텍스트 로드 (🔥 핵심)
  ============================== */
  async function loadContext() {
    const data = await fetchJSON(
      `${API}/api/task-chat/context?taskKey=${encodeURIComponent(taskKey)}`
    );

    ctx = data.context;

    metaText.innerText =
      `taskKey=${ctx.taskKey} · roomId=${ctx.roomId} · 역할=${ctx.role}`;
  }

  /* ===============================
     2️⃣ 기존 메시지 로드
  ============================== */
  async function loadMessages() {
    const data = await fetchJSON(
      `${API}/api/task-chat/messages?roomId=${ctx.roomId}`
    );

    chatBox.innerHTML = "";
    data.messages.forEach(renderMessage);
  }

  /* ===============================
     3️⃣ Socket 연결 (작업 전용)
  ============================== */
  function connectSocket() {
    socket = io(`${API}/task`, {
      withCredentials: true,
      transports: ["websocket"]
    });

    socket.on("connect", () => {
      socket.emit("task:join", { taskKey });
    });

    socket.on("task:new", (msg) => {
      if (String(msg.roomId) !== String(ctx.roomId)) return;
      renderMessage(msg);
    });

    socket.on("connect_error", (err) => {
      console.error("socket error:", err);
    });
  }

  /* ===============================
     4️⃣ 메시지 전송
  ============================== */
  function sendMessage() {
    const text = msgInput.value.trim();
    if (!text) return;

    msgInput.value = "";
    msgInput.focus();

    socket.emit("task:send", {
      taskKey,
      roomId: ctx.roomId,
      message: text
    });
  }

  sendBtn.addEventListener("click", sendMessage);
  msgInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") sendMessage();
  });

  /* ===============================
     초기 실행
  ============================== */
  (async () => {
    try {
      await loadContext();
      await loadMessages();
      connectSocket();
      sendBtn.disabled = false;
    } catch (err) {
      console.error(err);
      alert(err.message);

      if (err.message.includes("로그인")) {
        location.href = "/login.html";
      }
    }
  })();
})();
