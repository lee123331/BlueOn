/* ======================================================
   BlueOn 작업 전용 채팅 (최종 안정 버전)
   - DB 저장: REST API
   - 실시간 전파: Socket.io
====================================================== */

(() => {
  const API = "https://blueon.up.railway.app";

  /* ===============================
     DOM
  ============================== */
  const chatBox        = document.getElementById("chatMessages");
  const msgInput       = document.getElementById("chatInput");
  const sendBtn        = document.getElementById("sendBtn");
  const serviceTitleEl = document.getElementById("serviceTitle");
  const buyerNameEl    = document.getElementById("buyerName");

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
     상태
  ============================== */
  let ctx = null;
  let socket = null;

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

  async function fetchJSON(url, options = {}) {
    const res = await fetch(url, {
      credentials: "include",
      ...options,
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.success === false) {
      throw new Error(data.message || "요청 실패");
    }
    return data;
  }

  /* ===============================
     메시지 렌더링
  ============================== */
  function renderMessage(msg) {
    const isMine = msg.sender_id === ctx.myId;

    const wrap = document.createElement("div");
    wrap.style.display = "flex";
    wrap.style.justifyContent = isMine ? "flex-end" : "flex-start";
    wrap.style.marginBottom = "8px";

    const bubble = document.createElement("div");
    bubble.style.maxWidth = "70%";
    bubble.style.padding = "10px 14px";
    bubble.style.borderRadius = "14px";
    bubble.style.fontSize = "14px";
    bubble.style.background = isMine ? "#0056ff" : "#ffffff";
    bubble.style.color = isMine ? "#fff" : "#111827";
    bubble.style.border = isMine ? "none" : "1px solid #e5e7eb";

    bubble.innerHTML = `
      <div>${escapeHTML(msg.message)}</div>
      <div style="margin-top:4px;font-size:11px;opacity:0.6;">
        ${new Date(msg.created_at).toLocaleString()}
      </div>
    `;

    wrap.appendChild(bubble);
    chatBox.appendChild(wrap);
    scrollBottom();
  }

  /* ===============================
     1️⃣ 컨텍스트 로드
  ============================== */
  async function loadContext() {
    const data = await fetchJSON(
      `${API}/api/task-chat/context?taskKey=${encodeURIComponent(taskKey)}`
    );

    ctx = data.context;

    serviceTitleEl.innerText = ctx.serviceTitle || "서비스";
    buyerNameEl.innerText =
      ctx.buyer?.nickname || "의뢰인";
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
     3️⃣ Socket 연결 (전파 전용)
  ============================== */
  function connectSocket() {
    socket = io(`${API}/task`, {
      withCredentials: true,
      transports: ["websocket"],
    });

    socket.on("connect", () => {
      socket.emit("task:join", { taskKey });
    });

    socket.on("task:new", (msg) => {
      if (String(msg.room_id) !== String(ctx.roomId)) return;
      renderMessage(msg);
    });

    socket.on("connect_error", (err) => {
      console.error("socket error:", err);
    });
  }

  /* ===============================
     4️⃣ 메시지 전송 (🔥 핵심)
     - API → DB 저장
     - socket → 전파
  ============================== */
  async function sendMessage() {
    const text = msgInput.value.trim();
    if (!text) return;

    msgInput.value = "";
    msgInput.focus();

    // 1️⃣ DB 저장
    const data = await fetchJSON(`${API}/api/task-chat/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        roomId: ctx.roomId,
        message: text,
      }),
    });

    // 2️⃣ 실시간 전파 (DB 저장된 데이터 그대로)
    socket.emit("task:send", {
      taskKey,
      messageData: data.message,
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

      msgInput.disabled = false;
      sendBtn.disabled = false;
      msgInput.focus();
    } catch (err) {
      console.error(err);
      alert("채팅을 불러올 수 없습니다.");
    }
  })();
})();
