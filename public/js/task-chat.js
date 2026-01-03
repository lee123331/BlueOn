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
     🔥 한국 시간 포맷 (초 제거)
  ============================== */
  function formatKST(dateStr) {
    return new Date(dateStr).toLocaleString("ko-KR", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
  }

  /* ===============================
     메시지 렌더링
  ============================== */
  function renderMessage(msg) {
    const isMine = msg.sender_id === ctx.myId;

    const wrap = document.createElement("div");
    wrap.style.display = "flex";
    wrap.style.justifyContent = isMine ? "flex-end" : "flex-start";
    wrap.style.marginBottom = "10px";
    wrap.style.position = "relative";

    const bubble = document.createElement("div");
    bubble.style.maxWidth = "70%";
    bubble.style.padding = "10px 14px";
    bubble.style.borderRadius = "14px";
    bubble.style.fontSize = "14px";
    bubble.style.background = isMine ? "#0056ff" : "#ffffff";
    bubble.style.color = isMine ? "#fff" : "#111827";
    bubble.style.border = isMine ? "none" : "1px solid #e5e7eb";
    bubble.style.position = "relative";

    bubble.innerHTML = `
      <div>${escapeHTML(msg.message)}</div>
      <div style="margin-top:4px;font-size:11px;opacity:0.6;">
        ${formatKST(msg.created_at)}
      </div>
    `;

    /* ===============================
       🔥 내 메시지 삭제 (우클릭)
    ============================== */
    if (isMine && msg.id) {
      const deleteBtn = document.createElement("button");
      deleteBtn.textContent = "삭제";
      deleteBtn.style.position = "absolute";
      deleteBtn.style.top = "-26px";
      deleteBtn.style.right = "0";
      deleteBtn.style.fontSize = "12px";
      deleteBtn.style.padding = "4px 8px";
      deleteBtn.style.border = "1px solid #e5e7eb";
      deleteBtn.style.borderRadius = "6px";
      deleteBtn.style.background = "#fff";
      deleteBtn.style.cursor = "pointer";
      deleteBtn.style.display = "none";
      deleteBtn.style.zIndex = "10";

      deleteBtn.onclick = async (e) => {
        e.stopPropagation();
        if (!confirm("이 메시지를 삭제할까요?")) return;

        await fetchJSON(`${API}/chat/message/${msg.id}`, {
          method: "DELETE",
        });

        wrap.remove();
      };

      bubble.appendChild(deleteBtn);

      bubble.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        deleteBtn.style.display = "block";
      });

      document.addEventListener("click", () => {
        deleteBtn.style.display = "none";
      });
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
    buyerNameEl.innerText = ctx.buyer?.nickname || "의뢰인";
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
      const roomId = msg.room_id || msg.roomId;
      if (String(roomId) !== String(ctx.roomId)) return;
      renderMessage(msg);
    });

    socket.on("connect_error", (err) => {
      console.error("socket error:", err);
    });
  }

  /* ===============================
     4️⃣ 메시지 전송
  ============================== */
  async function sendMessage() {
    const text = msgInput.value.trim();
    if (!text) return;

    if (!ctx || !ctx.roomId || !taskKey) {
      alert("채팅 정보를 불러오지 못했습니다.");
      return;
    }

    msgInput.value = "";
    msgInput.focus();

    try {
      const data = await fetchJSON(`${API}/api/task-chat/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskKey,
          message: text,
        }),
      });

      // 🔥 즉시 렌더 (내 메시지)
      renderMessage(data.message);

      // 🔥 실시간 전파
      if (socket?.connected) {
        socket.emit("task:send", {
          taskKey,
          messageData: data.message,
        });
      }
    } catch (err) {
      alert(err.message || "메시지 전송 실패");
    }
  }

  /* ===============================
     이벤트
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
      alert("채팅을 불러올 수 없습니다.");
    }
  })();
})();
