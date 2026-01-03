/* ======================================================
   BlueOn 작업 전용 채팅 (HTML 완전 호환 최종본)
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

  const toastEl        = document.getElementById("toast");
  const lightboxEl     = document.getElementById("lightbox");
  const lightboxImgEl  = document.getElementById("lightboxImg");

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

  // 🔥 HH:MM 형식만
  function formatTime(ts) {
    const d = new Date(ts);
    return d.toLocaleTimeString("ko-KR", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  }

  function scrollBottom() {
    chatBox.scrollTop = chatBox.scrollHeight;
  }

  async function fetchJSON(url, options = {}) {
    const res = await fetch(url, { credentials: "include", ...options });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.success === false) {
      throw new Error(data.message || "요청 실패");
    }
    return data;
  }

  /* ===============================
     Toast
  ============================== */
  function showToast(msg) {
    if (!toastEl) return;
    toastEl.innerText = msg;
    toastEl.classList.add("show");
    setTimeout(() => toastEl.classList.remove("show"), 2000);
  }

  /* ===============================
     Lightbox
  ============================== */
  function openLightbox(src) {
    lightboxImgEl.src = src;
    lightboxEl.classList.add("show");
    lightboxEl.setAttribute("aria-hidden", "false");
  }

  lightboxEl.onclick = () => {
    lightboxEl.classList.remove("show");
    lightboxEl.setAttribute("aria-hidden", "true");
    lightboxImgEl.src = "";
  };

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

    // 삭제된 메시지
    if (msg.deleted) {
      bubble.innerHTML = `<em>삭제된 메시지입니다.</em>`;

    // 파일 메시지
    } else if (msg.type === "file") {
      const isImage =
        msg.file_url &&
        /\.(png|jpe?g|gif|webp)$/i.test(msg.file_url);

      if (isImage) {
        const img = document.createElement("img");
        img.src = msg.file_url;
        img.className = "chat-image";
        img.onclick = () => openLightbox(msg.file_url);

        const time = document.createElement("div");
        time.className = "time";
        time.textContent = formatTime(msg.created_at);

        bubble.appendChild(img);
        bubble.appendChild(time);
      } else {
        bubble.innerHTML = `
          <a href="${msg.file_url}" target="_blank">
            📄 ${escapeHTML(msg.file_name || "파일")}
          </a>
          <div class="time">${formatTime(msg.created_at)}</div>
        `;
      }

    // 텍스트 메시지
    } else {
      bubble.innerHTML = `
        <div>${escapeHTML(msg.message)}</div>
        <div class="time">
          ${formatTime(msg.created_at)}
          ${isMine && msg.is_read ? " ✔✔" : ""}
        </div>
      `;
    }

    // 삭제 버튼 (내 메시지)
    if (isMine && !msg.deleted) {
      const delBtn = document.createElement("button");
      delBtn.className = "msg-delete-btn";
      delBtn.innerText = "삭제";
      delBtn.onclick = async () => {
        await deleteMessage(msg.id);
        showToast("메시지가 삭제되었습니다");
      };
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
      ctx.buyer?.nickname || "의뢰인";
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
    await fetchJSON(`${API}/api/task-chat/delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messageId }),
    });
  }

  /* ===============================
     Socket.io (🔥 기본 namespace ONLY)
  ============================== */
 function connectSocket() {
  socket = io(API, {
  transports: ["polling", "websocket"], // 🔥 핵심
  withCredentials: true,
  path: "/socket.io",
});


  socket.on("connect", () => {
    socket.emit("task:join", { roomId: ctx.roomId });
  });

  socket.on("task:new", (msg) => {
    if (String(msg.room_id || msg.roomId) !== String(ctx.roomId)) return;
    renderMessage(msg);
    markAsRead();
  });

  socket.on("task:read", () => {
    document.querySelectorAll(".msg.me .time").forEach((t) => {
      if (!t.innerText.includes("✔✔")) t.innerText += " ✔✔";
    });
  });

  socket.on("connect_error", (err) => {
    console.error("❌ socket error:", err);
  });
}


  /* ===============================
     전송
  ============================== */
  function sendMessage() {
    const text = msgInput.value.trim();
    if (!text || !socket || !ctx) return;

    msgInput.value = "";

    socket.emit("task:send", {
      roomId: ctx.roomId,
      message: text,
    });
  }

  async function sendFile(file) {
    if (!file || !ctx) return;

    const fd = new FormData();
fd.append("file", file);
fd.append("taskKey", taskKey); // 🔥 이 줄 필수


    const data = await fetchJSON(`${API}/api/task-chat/upload`, {
      method: "POST",
      body: fd,
    });

    socket.emit("task:file", {
      roomId: ctx.roomId,
      type: "file",
      file_url: data.file.file_url,
      file_name: data.file.file_name,
    });
  }

  /* ===============================
     이벤트
  ============================== */
  sendBtn.onclick = sendMessage;

  msgInput.onkeydown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

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
