/* ======================================================
   BlueOn 작업 전용 채팅 (최종 완성본)
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
     🔥 KST 시간 포맷 (초 제거)
     - Date 재파싱 ❌
     - 문자열 기준
  ============================== */
function formatKST(dateStr) {
  if (!dateStr) return "";

  // 🔥 UTC 명시 (중요)
  const utcDate = new Date(dateStr.endsWith("Z") ? dateStr : dateStr + "Z");

  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(utcDate);
}


  /* ===============================
     메시지 렌더링
  ============================== */
  function renderMessage(msg, fromSocket = false) {
    // 🔥 socket으로 들어온 내 메시지는 무시 (중복 방지)
    if (fromSocket && msg.sender_id === ctx.myId) return;

    const isMine = msg.sender_id === ctx.myId;

    const wrap = document.createElement("div");
    wrap.className = "msg" + (isMine ? " me" : "");

    const bubble = document.createElement("div");
    bubble.className = "bubble";

bubble.innerHTML = `
  <div class="msg-text">${escapeHTML(msg.message)}</div>
  <div class="msg-time">
    ${formatKST(msg.created_at)}
  </div>
`;



    /* ===============================
       🔥 내 메시지 삭제 (우클릭)
    ============================== */
    if (isMine && msg.id) {
      const deleteBtn = document.createElement("button");
      deleteBtn.className = "msg-delete-btn";
      deleteBtn.textContent = "삭제";

      deleteBtn.onclick = async (e) => {
        e.stopPropagation();
        try {
          await fetchJSON(`${API}/chat/message/${msg.id}`, {
            method: "DELETE",
          });
          wrap.remove();
        } catch {
          alert("메시지 삭제 실패");
        }
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
    data.messages.forEach((m) => renderMessage(m));
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
      renderMessage(msg, true);
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

      // 🔥 내 메시지는 REST 응답으로만 렌더
      renderMessage(data.message);

      // 🔥 상대방에게만 socket 전파
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
    } catch {
      alert("채팅을 불러올 수 없습니다.");
    }
  })();
})();
