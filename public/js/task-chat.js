/* ======================================================
   BlueOn 작업 전용 채팅 (완성본)
====================================================== */
(() => {
  const API = "https://blueon.up.railway.app";

  const chatBox   = document.getElementById("chatMessages");
  const msgInput  = document.getElementById("chatInput");
  const sendBtn   = document.getElementById("sendBtn");
  const attachBtn = document.getElementById("attachBtn");
  const fileInput = document.getElementById("fileInput");

  const serviceTitleEl = document.getElementById("serviceTitle");
  const buyerNameEl    = document.getElementById("buyerName");

  const taskKey = new URLSearchParams(location.search).get("taskKey");
  if (!taskKey) return alert("잘못된 접근입니다.");

  let ctx = null;
  let socket = null;
  const rendered = new Set();

  /* ================= 유틸 ================= */
  const esc = s => String(s).replace(/[&<>"']/g,m=>({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[m]));

  const scrollBottom = () => chatBox.scrollTop = chatBox.scrollHeight;

  async function fetchJSON(url,opt={}){
    const r = await fetch(url,{credentials:"include",...opt});
    const d = await r.json();
    if(!r.ok||d.success===false) throw new Error(d.message||"실패");
    return d;
  }

  /* ================= 렌더 ================= */
  function renderMessage(msg){
    if(rendered.has(msg.id)) return;
    rendered.add(msg.id);

    const isMine = msg.sender_id === ctx.myId;
    const wrap = document.createElement("div");
    wrap.className = "msg" + (isMine ? " me":"");
    wrap.dataset.id = msg.id;

    const bubble = document.createElement("div");
    bubble.className = "bubble";

    if(msg.deleted){
      bubble.innerHTML = "<em>삭제된 메시지입니다.</em>";
    }else if(msg.type==="file"){
      bubble.innerHTML = `
        <a href="${msg.file_url}" target="_blank">📎 ${esc(msg.file_name)}</a>
        <div class="time">${new Date(msg.created_at).toLocaleString()}</div>
      `;
    }else{
      bubble.innerHTML = `
        <div>${esc(msg.message)}</div>
        <div class="time">
          ${new Date(msg.created_at).toLocaleString()}
          ${isMine && msg.is_read ? " ✔✔":""}
        </div>
      `;
    }

    if(isMine && !msg.deleted){
      const del = document.createElement("button");
      del.className="msg-delete-btn";
      del.innerText="삭제";
      del.onclick=()=>deleteMessage(msg.id);
      bubble.appendChild(del);
    }

    wrap.appendChild(bubble);
    chatBox.appendChild(wrap);
    scrollBottom();
  }

  /* ================= 로드 ================= */
  async function loadContext(){
    const d = await fetchJSON(`${API}/api/task-chat/context?taskKey=${taskKey}`);
    ctx = d.context;
    serviceTitleEl.innerText = ctx.serviceTitle || "서비스";
    buyerNameEl.innerText = ctx.buyer?.nickname || "의뢰인";
  }

  async function loadMessages(){
    const d = await fetchJSON(`${API}/api/task-chat/messages?roomId=${ctx.roomId}`);
    chatBox.innerHTML="";
    rendered.clear();
    d.messages.forEach(renderMessage);
    await markRead();
  }

  async function markRead(){
    await fetchJSON(`${API}/api/task-chat/read`,{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({roomId:ctx.roomId})
    });
  }

  async function deleteMessage(id){
    if(!confirm("메시지를 삭제할까요?")) return;
    await fetchJSON(`${API}/api/task-chat/delete`,{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({messageId:id})
    });
  }

  /* ================= 소켓 ================= */
  function connectSocket(){
    socket = io(API, { withCredentials: true });

    socket.on("connect",()=>{
      socket.emit("task:join",{roomId:ctx.roomId});
    });

    socket.on("task:new",msg=>{
      if(String(msg.roomId)!==String(ctx.roomId)) return;
      renderMessage(msg);
      markRead();
    });

    socket.on("task:read",()=>{
      document.querySelectorAll(".msg.me .time").forEach(t=>{
        if(!t.innerText.includes("✔✔")) t.innerText+=" ✔✔";
      });
    });
  }

  /* ================= 전송 ================= */
  function sendMessage(){
    const text = msgInput.value.trim();
    if(!text) return;
    msgInput.value="";
    socket.emit("task:send",{taskKey,roomId:ctx.roomId,message:text});
  }

  async function sendFile(file){
    const fd = new FormData();
    fd.append("file",file);
    fd.append("taskKey",taskKey);
    const d = await fetchJSON(`${API}/api/task-chat/upload`,{method:"POST",body:fd});
    socket.emit("task:file",{roomId:ctx.roomId,...d.file});
  }

  sendBtn.onclick = sendMessage;
  msgInput.onkeydown = e=>e.key==="Enter"&&sendMessage();

  attachBtn.onclick = ()=>fileInput.click();
  fileInput.onchange = ()=>{
    if(fileInput.files[0]) sendFile(fileInput.files[0]);
    fileInput.value="";
  };

  /* ================= 시작 ================= */
  (async()=>{
    await loadContext();
    await loadMessages();
    connectSocket();
    msgInput.disabled=false;
    sendBtn.disabled=false;
    msgInput.focus();
  })();

})();
