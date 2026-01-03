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
   메시지 렌더링 (우클릭 삭제 포함)
============================== */
function renderMessage(msg) {
  const isMine = msg.sender_id === ctx.myId;

  /* wrapper */
  const wrap = document.createElement("div");
  wrap.style.display = "flex";
  wrap.style.justifyContent = isMine ? "flex-end" : "flex-start";
  wrap.style.marginBottom = "10px";

  /* bubble */
  const bubble = document.createElement("div");
  bubble.style.position = "relative"; // 🔥 삭제 버튼 기준점
  bubble.style.maxWidth = "70%";
  bubble.style.padding = "10px 14px 22px 14px"; // 🔥 아래 여백 확보
  bubble.style.borderRadius = "14px";
  bubble.style.fontSize = "14px";
  bubble.style.lineHeight = "1.4";
  bubble.style.background = isMine ? "#0056ff" : "#ffffff";
  bubble.style.color = isMine ? "#ffffff" : "#111827";
  bubble.style.border = isMine ? "none" : "1px solid #e5e7eb";

  /* 메시지 내용 */
  const textEl = document.createElement("div");
  textEl.innerHTML = escapeHTML(msg.message);

  /* 시간 */
  const timeEl = document.createElement("div");
  timeEl.style.marginTop = "6px";
  timeEl.style.fontSize = "11px";
  timeEl.style.opacity = "0.6";
  timeEl.style.textAlign = "right";
  timeEl.style.color = isMine ? "rgba(255,255,255,0.7)" : "#6b7280";
  timeEl.innerText = new Date(msg.created_at).toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });

  bubble.appendChild(textEl);
  bubble.appendChild(timeEl);

  /* ===============================
     🔥 삭제 버튼 (내 메시지 전용)
  ============================== */
  if (isMine) {
    const deleteBtn = document.createElement("button");
    deleteBtn.innerText = "삭제";
    deleteBtn.style.position = "absolute";
    deleteBtn.style.top = "-8px";
    deleteBtn.style.right = "-8px";
    deleteBtn.style.fontSize = "11px";
    deleteBtn.style.padding = "4px 6px";
    deleteBtn.style.borderRadius = "6px";
    deleteBtn.style.border = "none";
    deleteBtn.style.background = "#ff4d4f";
    deleteBtn.style.color = "#fff";
    deleteBtn.style.cursor = "pointer";
    deleteBtn.style.display = "none";
    deleteBtn.style.zIndex = "10";

    deleteBtn.onclick = async (e) => {
      e.stopPropagation();
      if (!confirm("이 메시지를 삭제할까요?")) return;

      await fetchJSON(`${API}/api/task-chat/delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId: msg.id }),
      });

      wrap.remove();
    };

    // 🔥 우클릭 시 삭제 버튼 표시
    bubble.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      deleteBtn.style.display = "block";
    });

    // 다른 곳 클릭 시 숨김
    document.addEventListener("click", () => {
      deleteBtn.style.display = "none";
    });

    bubble.appendChild(deleteBtn);
  }

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

  // 🔒 필수 컨텍스트 방어
  if (!ctx || !ctx.roomId || !taskKey) {
    console.error("❌ 필수 값 누락", { ctx, taskKey });
    alert("채팅 정보를 불러오지 못했습니다. 새로고침 해주세요.");
    return;
  }

  // 입력창 즉시 비우기
  msgInput.value = "";
  msgInput.focus();

  try {
    /* ===============================
       1️⃣ DB 저장 (HTTP API)
       서버는 taskKey + message만 받음
    ============================== */
    const data = await fetchJSON(`${API}/api/task-chat/send`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        taskKey: taskKey,   // 🔥 핵심
        message: text,
      }),
    });

    /* ===============================
       2️⃣ 실시간 전파 (Socket)
       - 서버에서 저장된 message 그대로 전달
    ============================== */
    if (socket && socket.connected) {
      socket.emit("task:send", {
        taskKey: taskKey,
        messageData: data.message,
      });
    }

    // 🔥 내가 보낸 메시지는 즉시 화면에 렌더
    renderMessage(data.message);

  } catch (err) {
    console.error("❌ 메시지 전송 실패:", err);
    alert(err.message || "메시지 전송에 실패했습니다.");
  }
}

/* ===============================
   이벤트 바인딩
============================== */
sendBtn.addEventListener("click", sendMessage);

msgInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    sendMessage();
  }
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
