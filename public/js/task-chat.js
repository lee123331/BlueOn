/* ======================================================
   BlueOn 작업 전용 채팅 (1단계: DB 저장 검증용)
   file: public/js/task-chat.js
   기준: taskKey → context → roomId
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
     URL
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
     메시지 렌더
  ============================== */
  function renderMessage(msg) {
    const isMine = msg.sender_id === ctx.myId;

    const wrap = document.createElement("div");
    wrap.className = "msg" + (isMine ? " me" : "");

    const bubble = document.createElement("div");
    bubble.className = "bubble";

    const time = msg.created_at
      ? new Date(msg.created_at).toLocaleTimeString("ko-KR", {
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        })
      : "";

    bubble.innerHTML = `
      <div>${escapeHTML(msg.message || "")}</div>
      <div class="time">${time}</div>
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

    serviceTitleEl.innerText =
      ctx.serviceTitle || "서비스";

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
     3️⃣ 메시지 전송 (🔥 DB 저장 핵심)
  ============================== */
async function sendMessage() {
  const text = msgInput.value.trim();
  if (!text) return;

  msgInput.value = "";
  msgInput.focus();

  const data = await fetchJSON(`${API}/api/task-chat/send`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      taskKey,        // 🔥 핵심: 서버 기준은 taskKey
      message: text,
    }),
  });

  // 서버가 DB에 저장한 메시지를 그대로 렌더
  renderMessage(data.message);
}


  sendBtn.onclick = sendMessage;
  msgInput.onkeydown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      sendMessage();
    }
  };

  /* ===============================
     시작
  ============================== */
  (async () => {
    try {
      await loadContext();
      await loadMessages();

      msgInput.disabled = false;
      sendBtn.disabled = false;
      msgInput.focus();
    } catch (err) {
      console.error(err);
      alert(err.message || "채팅을 불러올 수 없습니다.");
    }
  })();
})();
