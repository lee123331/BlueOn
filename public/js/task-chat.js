/* ======================================================
   BlueOn 작업 전용 채팅
   file: public/js/task-chat.js
   기준: taskKey (서버가 진실)
====================================================== */

(() => {
  const API = "https://blueon.up.railway.app";

  /* DOM */
  const chatMessages = document.getElementById("chatMessages");
  const chatInput    = document.getElementById("chatInput");
  const sendBtn      = document.getElementById("sendBtn");
  const serviceTitle = document.getElementById("serviceTitle");
  const buyerName    = document.getElementById("buyerName");

  /* URL */
  const taskKey = new URLSearchParams(location.search).get("taskKey");
  if (!taskKey) {
    alert("잘못된 접근입니다.");
    location.href = "/";
    return;
  }

  /* State */
  let roomId = null;
  let myId   = null;
  let socket = null;

  /* Utils */
  function escapeHTML(str) {
    return String(str)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }
  function scrollBottom() {
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  /* Render */
  function renderMessage(msg) {
    const isMine = Number(msg.sender_id) === Number(myId);

    const wrap = document.createElement("div");
    wrap.style.display = "flex";
    wrap.style.justifyContent = isMine ? "flex-end" : "flex-start";
    wrap.style.marginBottom = "10px";

    const bubble = document.createElement("div");
    bubble.style.maxWidth = "70%";
    bubble.style.padding = "10px 14px";
    bubble.style.borderRadius = "14px";
    bubble.style.fontSize = "14px";
    bubble.style.background = isMine ? "#0056ff" : "#ffffff";
    bubble.style.color = isMine ? "#ffffff" : "#111827";
    bubble.style.border = isMine ? "none" : "1px solid #e5e7eb";

    bubble.innerHTML = `
      <div>${escapeHTML(msg.message)}</div>
      <div style="font-size:11px; opacity:.6; margin-top:6px;">
        ${new Date(msg.created_at).toLocaleString()}
      </div>
    `;

    wrap.appendChild(bubble);
    chatMessages.appendChild(wrap);
    scrollBottom();
  }

  /* 1️⃣ Context (🔥 핵심) */
  async function loadContext() {
    // 주문 단위 정보
    const res = await fetch(
      `${API}/expert/tasks/detail?taskKey=${encodeURIComponent(taskKey)}`,
      { credentials: "include" }
    );
    const data = await res.json();
    if (!data.success) throw new Error("작업 정보를 불러올 수 없습니다.");

    const t = data.task;
    roomId = t.room_id;
    if (!roomId) throw new Error("채팅방이 아직 생성되지 않았습니다.");

    // 🔥 UI: 서비스명 + 구매자 1명만 표시
    serviceTitle.innerText = t.service_title;
    buyerName.innerText = t.buyer_nickname || "의뢰인";

    // 내 정보
    const meRes = await fetch(`${API}/auth/me`, { credentials: "include" });
    const meData = await meRes.json();
    if (!meData.success) throw new Error("로그인이 필요합니다.");
    myId = meData.user.id;
  }

  /* 2️⃣ Messages */
  async function loadMessages() {
    const res = await fetch(`${API}/chat/messages?roomId=${roomId}`, {
      credentials: "include"
    });
    const data = await res.json();
    if (!data.success) return;

    chatMessages.innerHTML = "";
    data.messages.forEach(renderMessage);
  }

  /* 3️⃣ Socket */
  function connectSocket() {
    socket = io(API, { withCredentials: true, transports: ["websocket"] });

    socket.on("connect", () => {
      socket.emit("chat:join", roomId);
    });

    socket.on("chat:message", (msg) => {
      if (String(msg.roomId) !== String(roomId)) return;
      renderMessage(msg);
    });
  }

  /* 4️⃣ Send */
  async function sendMessage() {
    const text = chatInput.value.trim();
    if (!text) return;

    chatInput.value = "";

    await fetch(`${API}/chat/send-message`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        roomId,
        senderId: myId,
        message: text,
        message_type: "text"
      })
    });
  }

  sendBtn.addEventListener("click", sendMessage);
  chatInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") sendMessage();
  });

  /* Init */
  (async () => {
    try {
      await loadContext();
      await loadMessages();
      connectSocket();
      chatInput.disabled = false;
      sendBtn.disabled = false;
    } catch (e) {
      console.error(e);
      alert(e.message);
    }
  })();
})();
