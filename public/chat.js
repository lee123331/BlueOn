console.log("🔥 chat.js FINAL COMPLETE loaded");

const API = "https://blueon.up.railway.app";

/* ======================================================
   URL 파라미터 (표준: roomType + roomId)
   - 표준:  /chat.html?roomType=work&roomId=14
   - 호환:  /chat.html?type=work&roomId=14  (기존 코드)
====================================================== */
const params = new URLSearchParams(location.search);

// ✅ roomType: 표준(roomType) 우선, 없으면 호환(type), 그래도 없으면 null
const ROOM_TYPE_RAW = params.get("roomType") || params.get("type");

// ✅ roomId: string -> number 로 통일
const ROOM_ID_RAW = params.get("roomId");
const ROOM_ID = ROOM_ID_RAW ? Number(ROOM_ID_RAW) : null;

// ✅ roomType 정규화 (work/service 외 값은 기본 work로 처리하거나 null로)
function normalizeRoomType(v) {
  const t = String(v || "").trim();
  if (t === "work" || t === "service") return t;
  return null; // 엄격 모드
}

// 엄격하게 가려면 null 유지, 느슨하게 가려면 "work" 기본값
const ROOM_TYPE = normalizeRoomType(ROOM_TYPE_RAW); // "work" | "service" | null

// ✅ 현재 방 키 (roomType:roomId)
function makeRoomKey(roomType, roomId) {
  const t = normalizeRoomType(roomType) || "work";
  return `${t}:${String(roomId)}`;
}

// ✅ 삭제된 방 재등장 방지용 (localStorage 영구 저장)
const DELETED_ROOMS_STORAGE_KEY = "DELETED_ROOMS_V1";
const DELETED_ROOMS = new Set(
  JSON.parse(localStorage.getItem(DELETED_ROOMS_STORAGE_KEY) || "[]")
);

function markRoomDeleted(roomType, roomId) {
  const key = makeRoomKey(roomType, roomId);
  DELETED_ROOMS.add(key);
  localStorage.setItem(DELETED_ROOMS_STORAGE_KEY, JSON.stringify([...DELETED_ROOMS]));
}

function isRoomDeleted(roomType, roomId) {
  const key = makeRoomKey(roomType, roomId);
  return DELETED_ROOMS.has(key);
}

// ✅ 디버그 로그 (문제 생기면 여기부터 확인)
console.log("🔎 URL parsed:", {
  search: location.search,
  ROOM_ID_RAW,
  ROOM_ID,
  ROOM_TYPE_RAW,
  ROOM_TYPE,
});


/* ======================================================
   DOM
====================================================== */
const chatListArea = document.getElementById("chatList");
const chatBody = document.getElementById("chatBody");
const msgInput = document.getElementById("msgInput");
const sendBtn = document.getElementById("sendBtn");
const fileBtn = document.getElementById("fileBtn");
const fileInput = document.getElementById("fileInput");

const headerImg = document.getElementById("chatProfileImg");
const headerName = document.getElementById("chatProfileName");

const imgModal = document.getElementById("imgModal");
const imgView = document.getElementById("imgModalView");

/* 메시지 삭제 모달 */
const deleteModal = document.getElementById("deleteConfirmModal");
const confirmCancelBtn = document.getElementById("confirmCancel");
const confirmDeleteBtn = document.getElementById("confirmDelete");

/* 채팅방 삭제 모달 */
const roomDeleteModal = document.getElementById("roomDeleteModal");
const roomDeleteCancel = document.getElementById("roomDeleteCancel");
const roomDeleteConfirm = document.getElementById("roomDeleteConfirm");

/* ======================================================
   상태
====================================================== */
let CURRENT_USER = null;
let socket = null;

// 내가 낙관적으로 그려둔 메시지들(중복 방지용)
const PENDING_CLIENT_IDS = new Set();

// 메시지 삭제 모달 상태
let DELETE_TARGET_MSG_ID = null;
let DELETE_TARGET_ROW = null;

// ✅ 채팅방 삭제 모달 상태 (핵심)
let PENDING_DELETE_ROOM_ID = null;
let PENDING_DELETE_ROOM_TYPE = null; // "work" | "service" | null

/* ======================================================
   공통 유틸
====================================================== */
function safeStr(v) {
  return v == null ? "" : String(v);
}

function scrollBottom() {
  if (!chatBody) return;
  chatBody.scrollTop = chatBody.scrollHeight;
}

function genClientMsgId() {
  return `c_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

// ✅ roomId만으로 찾던 기존 호환 유지
function getChatItem(roomId) {
  return document.querySelector(`.chat-item[data-room-id="${safeStr(roomId)}"]`);
}

// ✅ roomType+roomId로 정확히 찾기 (유령방/충돌 해결)
function getChatItemByKey(roomType, roomId) {
  const key = makeRoomKey(roomType, roomId);
  return document.querySelector(`.chat-item[data-room-key="${key}"]`);
}


function showUnreadBadge(roomId, cnt = null) {
  const item = getChatItem(roomId);
  if (!item) return;
  const badge = item.querySelector(".chat-unread-badge");
  if (!badge) return;

  const n = cnt == null ? null : Number(cnt);
  if (n != null && n > 0) {
    badge.style.display = "inline-flex";
    badge.textContent = n > 99 ? "99+" : String(n);
  } else {
    badge.style.display = "inline-flex";
    if (!badge.textContent) badge.textContent = "•";
  }
}

function hideUnreadBadge(roomId) {
  const item = getChatItem(roomId);
  if (!item) return;
  const badge = item.querySelector(".chat-unread-badge");
  if (!badge) return;
  badge.style.display = "none";
  badge.textContent = "";
}

function updateLeftLastMsg(roomId, text, roomType = null) {
  let item = null;

  if (roomType) item = getChatItemByKey(roomType, roomId);
  if (!item) item = getChatItem(roomId);
  if (!item) return;

  const el = item.querySelector(".chat-last");
  if (el) el.textContent = text || "";
}


function pickRoomId(r) {
  return safeStr(r?.roomId || r?.room_id || r?.id || r?.room || r?.roomID);
}

function pickRoomType(r) {
  // 서버 호환: room_type 또는 roomType
  const t = safeStr(r?.room_type || r?.roomType || "");
  return t || "work"; // 기본값 work
}



/* ======================================================
   unread 동기화
====================================================== */
async function applyRoomUnreadCounts() {
  try {
    const res = await fetch(`${API}/chat/unread-count`, { credentials: "include" });
    const data = await res.json().catch(() => null);
    if (!data || !data.success) return;

    // ✅ 서버 응답 호환:
    // 1) 최신: data.rooms = { "work:14": 2, "service:14": 1, ... }
    // 2) 구형: data.rooms = { "14": 2, "15": 1, ... }
    // 3) 다른 키: data.map, data.unreadMap 등도 대비
    const map = data.rooms || data.map || data.unreadMap || {};

    // ✅ 앞으로는 roomKey 기준이 정석이므로 data-room-key를 우선 사용
    document.querySelectorAll(".chat-item[data-room-key], .chat-item[data-room-id]").forEach((item) => {
      const rid = safeStr(item.dataset.roomId);
      const rtype = safeStr(item.dataset.roomType || "work");
      const key = safeStr(item.dataset.roomKey) || makeRoomKey(rtype, rid);

      // ✅ 우선순위: key → rid(구형 호환) → 0
      const cnt = Number(map[key] ?? map[rid] ?? 0);

      const badge = item.querySelector(".chat-unread-badge");
      if (!badge) return;

      if (cnt > 0) {
        badge.style.display = "inline-flex";
        badge.textContent = cnt > 99 ? "99+" : String(cnt);
      } else {
        badge.style.display = "none";
        badge.textContent = "";
      }
    });
  } catch (e) {
    console.warn("applyRoomUnreadCounts fail", e);
  }
}

/* ======================================================
   🗑 메시지 삭제 모달
====================================================== */
function openDeleteConfirm(messageId, rowEl) {
  DELETE_TARGET_MSG_ID = messageId;
  DELETE_TARGET_ROW = rowEl;

  if (deleteModal) deleteModal.style.display = "flex";
}

function closeDeleteConfirm() {
  DELETE_TARGET_MSG_ID = null;
  DELETE_TARGET_ROW = null;

  if (deleteModal) deleteModal.style.display = "none";
}

if (confirmCancelBtn) confirmCancelBtn.onclick = closeDeleteConfirm;

if (deleteModal) {
  deleteModal.addEventListener("click", (e) => {
    if (e.target === deleteModal) closeDeleteConfirm();
  });
}

if (confirmDeleteBtn) {
  confirmDeleteBtn.onclick = async () => {
    if (!DELETE_TARGET_MSG_ID) return;

    const targetId = DELETE_TARGET_MSG_ID;
    const targetRow = DELETE_TARGET_ROW;

    // UI 즉시 제거
    if (targetRow) targetRow.remove();
    closeDeleteConfirm();

    try {
try {
  const res = await fetch(`${API}/chat/message/${encodeURIComponent(targetId)}`, {
    method: "DELETE",
    credentials: "include",
  });

  const data = await res.json().catch(() => null);

  if (!data || !data.success) {
    console.log("❌ delete failed:", data, "messageId=", targetId);
    location.reload(); // 실패 시 동기화
  }
} catch (e) {
  console.warn("❌ delete request error", e);
  location.reload();
}


      const data = await res.json().catch(() => null);
      if (!data || !data.success) {
        console.log("❌ delete failed:", data, "roomId=", ROOM_ID);
        // 실패 시 동기화
        location.reload();
      }
    } catch (e) {
      console.warn("❌ delete request error", e);
      location.reload();
    }
  };
}

/* ======================================================
   🗑 채팅방 삭제 모달 (전역 1회)
====================================================== */
function openRoomDeleteModal(roomId, roomType) {
  PENDING_DELETE_ROOM_ID = safeStr(roomId);
  PENDING_DELETE_ROOM_TYPE = safeStr(roomType || "work"); // ✅ 핵심: 타입 저장
  if (roomDeleteModal) roomDeleteModal.style.display = "flex";
}

function closeRoomDeleteModal() {
  PENDING_DELETE_ROOM_ID = null;
  PENDING_DELETE_ROOM_TYPE = null;
  if (roomDeleteModal) roomDeleteModal.style.display = "none";
}

if (roomDeleteCancel) roomDeleteCancel.onclick = closeRoomDeleteModal;

if (roomDeleteModal) {
  roomDeleteModal.addEventListener("click", (e) => {
    if (e.target === roomDeleteModal) closeRoomDeleteModal();
  });
}

/* ======================================================
   로그인 유저
====================================================== */
async function loadMe() {
  const res = await fetch(`${API}/auth/me`, { credentials: "include" });
  const data = await res.json().catch(() => null);

  if (!data || !data.success) {
    location.href = "/login.html";
    return;
  }
  CURRENT_USER = data.user;
}

/* ======================================================
   좌측 채팅방 목록 (완전본)
   - 헤더 유지
   - roomType:id 기준 중복 제거 (유령 방 방지)
   - DELETED_ROOMS에 기록된 key는 재등장 방지
   - 삭제 버튼 클릭 시 방 이동 차단 + 모달 오픈(✅ roomType 전달)
====================================================== */
async function loadChatList() {
  const listEl = document.getElementById("chatList");
  if (!listEl) return;

  listEl.innerHTML = "<h2>메시지</h2>";

  try {
    const res = await fetch(`${API}/chat/rooms`, { credentials: "include" });
    const data = await res.json().catch(() => null);

    console.log("🧪 chat rooms response =", data);

    if (!data || !data.success) {
      const empty = document.createElement("div");
      empty.style.padding = "12px";
      empty.style.color = "#6b7280";
      empty.style.fontSize = "13px";
      empty.textContent = "채팅 목록을 불러오지 못했습니다.";
      listEl.appendChild(empty);
      return;
    }

    const rooms = Array.isArray(data.rooms) ? data.rooms : [];

    // ✅ roomType:id 기준 중복 제거 + 삭제 캐시 필터링
    const map = new Map();
    for (const r of rooms) {
      const rid = String(pickRoomId(r) || "");
      if (!rid) continue;

      const rtype = pickRoomType(r);
      const key = makeRoomKey(rtype, rid);

      if (DELETED_ROOMS.has(key)) continue;
      map.set(key, r);
    }

    const uniqRooms = Array.from(map.values());

    if (uniqRooms.length === 0) {
      const empty = document.createElement("div");
      empty.style.padding = "12px";
      empty.style.color = "#6b7280";
      empty.style.fontSize = "13px";
      empty.textContent = "아직 대화가 없습니다.";
      listEl.appendChild(empty);
      return;
    }

    uniqRooms.forEach((room) => {
      const roomId = String(pickRoomId(room) || "");
      if (!roomId) return;

      const roomType = pickRoomType(room);
      const key = makeRoomKey(roomType, roomId);

      if (DELETED_ROOMS.has(key)) return;

      const item = document.createElement("div");
      item.className = "chat-item";

      // ✅ 기존 호환 + 신규 key
      item.dataset.roomId = safeStr(roomId);
      item.dataset.roomType = safeStr(roomType);
      item.dataset.roomKey = safeStr(key);

      const unreadOn = Number(room.unread || 0) > 0;

      item.innerHTML = `
        <div class="chat-left">
          <img src="${room.avatar || "/assets/default_profile.png"}" alt="avatar">
          <div class="chat-texts">
            <div class="chat-name-row">
              <div class="chat-name">${room.nickname || "상대방"}</div>
              <span class="chat-unread-badge" style="display:${unreadOn ? "inline-flex" : "none"}">
                ${
                  unreadOn
                    ? (Number(room.unread) > 99 ? "99+" : String(Number(room.unread || 0)))
                    : ""
                }
              </span>
            </div>
            <div class="chat-last">${room.last_msg || ""}</div>
          </div>
        </div>

        <button class="room-delete-btn"
                type="button"
                title="채팅방 삭제"
                aria-label="채팅방 삭제">🗑</button>
      `;

      item.onclick = (e) => {
        if (e.target.closest(".room-delete-btn")) {
          e.preventDefault();
          e.stopPropagation();
          openRoomDeleteModal(roomId, roomType); // ✅ roomType 전달
          return;
        }

        hideUnreadBadge(roomId);
        // ✅ type 파라미터는 호환 유지(없어도 기존 동작), 있으면 정확도↑
        location.href = `/chat.html?roomType=${encodeURIComponent(roomType)}&roomId=${encodeURIComponent(roomId)}`;

      };

      listEl.appendChild(item);
    });
  } catch (e) {
    console.warn("❌ loadChatList error:", e);

    listEl.innerHTML = "<h2>메시지</h2>";
    const empty = document.createElement("div");
    empty.style.padding = "12px";
    empty.style.color = "#6b7280";
    empty.style.fontSize = "13px";
    empty.textContent = "채팅 목록 로딩 중 오류가 발생했습니다.";
    listEl.appendChild(empty);
  }
}

/* ======================================================
   채팅방 삭제 유틸
====================================================== */
function removeRoomFromUI(roomId, roomType = null) {
  // ✅ 우선 key로 제거(정확), 없으면 기존 방식(roomId)로 제거(호환)
  if (roomType) {
    const elByKey = getChatItemByKey(roomType, roomId);
    if (elByKey) {
      elByKey.remove();
      return;
    }
  }
  const el = document.querySelector(`.chat-item[data-room-id="${safeStr(roomId)}"]`);
  if (el) el.remove();
}

function closeIfCurrentRoom(roomId) {
  const current = safeStr(new URLSearchParams(location.search).get("roomId"));
  if (safeStr(roomId) === current) {
    location.href = "/chat.html";
  }
}

/* ======================================================
   🗑 채팅방 삭제 확정 처리 (모달 버튼) - 완전본
   - 성공 시에만 UI 제거
   - DELETED_ROOMS에 type:id 기록 → 재등장 방지
   - roomType을 서버에 전송(서버가 지원하면 정확 삭제)
   - 서버가 아직 roomType을 안 받는 경우에도 동작(무시됨)
====================================================== */
if (roomDeleteConfirm) {
  roomDeleteConfirm.onclick = async (e) => {
    e.preventDefault();
    e.stopPropagation();

    if (!PENDING_DELETE_ROOM_ID) return;

    const roomId = String(PENDING_DELETE_ROOM_ID);
    const roomType = String(PENDING_DELETE_ROOM_TYPE || "work");
    const key = makeRoomKey(roomType, roomId);

    closeRoomDeleteModal();
    roomDeleteConfirm.disabled = true;

    try {
      const res = await fetch(`${API}/chat/delete-room`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roomId: Number(roomId) || roomId,
          roomType, // ✅ 서버가 받으면 work/service 정확 삭제, 안 받으면 그냥 무시됨(호환)
        }),
      });

      const data = await res.json().catch(() => null);

      if (!data || !data.success) {
        console.warn("❌ delete-room failed:", data);
        await loadChatList();
        await applyRoomUnreadCounts();
        return;
      }

      // ✅ 서버가 돌려준 값 우선(없으면 기존값)
      const deletedId = String(data.roomId || roomId);
      const deletedType = String(data.roomType || roomType);
      const deletedKey = makeRoomKey(deletedType, deletedId);

      // ✅ 재등장 방지
      DELETED_ROOMS.add(deletedKey);
      if (deletedKey !== key) DELETED_ROOMS.add(key);

      // ✅ 성공 시에만 UI 제거
      removeRoomFromUI(deletedId, deletedType);
      // 혹시 남아있으면 기존 키로도 제거 시도
      removeRoomFromUI(roomId, roomType);

      // ✅ 현재 방이면 이동
      closeIfCurrentRoom(deletedId);

      // ✅ 서버 기준 재동기화
      await loadChatList();
      await applyRoomUnreadCounts();
    } catch (err) {
      console.warn("❌ delete-room network/server error:", err);
      await loadChatList();
      await applyRoomUnreadCounts();
    } finally {
      roomDeleteConfirm.disabled = false;
    }
  };
}

/* ======================================================
   상단 방 정보
====================================================== */
async function loadRoomInfo() {
  if (!ROOM_ID) return;

  // ✅ type 파라미터 있으면 같이 전달(서버가 무시해도 OK)
  const qs = new URLSearchParams();
  qs.set("roomId", ROOM_ID);
 if (ROOM_TYPE) qs.set("roomType", ROOM_TYPE);


  const res = await fetch(`${API}/chat/room-info?${qs.toString()}`, {
    credentials: "include",
  });
  const data = await res.json().catch(() => null);
  if (!data || !data.success) return;

  if (headerImg) headerImg.src = data.avatar || "/assets/default_profile.png";
  if (headerName) headerName.textContent = data.nickname || "상대방";
}

/* ======================================================
   메시지 로드
====================================================== */
async function loadMessages() {
  if (!ROOM_ID || !chatBody) return;

  // ✅ type 파라미터 있으면 같이 전달(서버가 무시해도 OK)
  const qs = new URLSearchParams();
  qs.set("roomId", ROOM_ID);
 if (ROOM_TYPE) qs.set("roomType", ROOM_TYPE);


  const res = await fetch(`${API}/chat/messages?${qs.toString()}`, {
    credentials: "include",
  });
  const data = await res.json().catch(() => null);
  if (!data || !data.success) return;

  chatBody.innerHTML = "";
  (data.messages || []).forEach(renderMsg);
  scrollBottom();
}

/* ======================================================
   읽음 처리
====================================================== */
function markRoomAsRead(roomId) {
  if (!roomId) return;

  // ✅ type은 있으면 같이, 없으면 기존처럼
  const payload = { roomId };
  payload.roomType = ROOM_TYPE || "work";


  fetch(`${API}/chat/read`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).catch(() => {});

  hideUnreadBadge(roomId);
}

/* ======================================================
   ✅ 메시지 렌더
====================================================== */
function renderMsg(msg) {
  if (!chatBody || !CURRENT_USER) return;

  // id 필드 호환
  if (msg.id == null && msg.message_id != null) msg.id = msg.message_id;

  const senderId = Number(msg.sender_id);
  const isMe = senderId === Number(CURRENT_USER.id);
  const type = msg.message_type || msg.type || "text";

  const content =
    type === "image"
      ? (msg.file_url || msg.message || msg.content)
      : (msg.message || msg.content);

  if (!content) return;

  // 1) pending 치환
  if (msg.clientMsgId) {
    const pendingEl = document.querySelector(
      `.msg-row[data-client-msg-id="${safeStr(msg.clientMsgId)}"]`
    );

    if (pendingEl && msg.id != null) {
      pendingEl.dataset.messageId = safeStr(msg.id);

      const readEl = pendingEl.querySelector(".read-state");
      if (readEl) readEl.textContent = msg.is_read ? "읽음" : "";

      PENDING_CLIENT_IDS.delete(msg.clientMsgId);
      return;
    }
  }

  // 2) messageId 중복 방지
  if (msg.id != null) {
    const exist = document.querySelector(
      `.msg-row[data-message-id="${safeStr(msg.id)}"]`
    );
    if (exist) return;
  }

  // 3) row 생성
  const row = document.createElement("div");
  row.className = `msg-row ${isMe ? "me" : "other"}`;

  if (msg.id != null) row.dataset.messageId = safeStr(msg.id);
  if (msg.clientMsgId) row.dataset.clientMsgId = safeStr(msg.clientMsgId);

  // 4) 말풍선
  const bubble = document.createElement("div");
  bubble.className = "msg-bubble";

  if (type === "image") {
    const img = document.createElement("img");
    img.src = content;
    img.alt = "image";
    img.onclick = () => openImageModal(content);
    bubble.appendChild(img);
  } else {
    bubble.textContent = content;
  }

  row.appendChild(bubble);

  // 5) 읽음 표시(내 메시지)
  if (isMe) {
    const read = document.createElement("span");
    read.className = "read-state";
    read.textContent = msg.is_read ? "읽음" : "";
    row.appendChild(read);
  }

  // 6) 메시지 삭제 버튼(내 메시지)
  if (isMe) {
    const delBtn = document.createElement("button");
    delBtn.className = "msg-delete-btn";
    delBtn.type = "button";
    delBtn.textContent = "삭제";

    delBtn.onclick = (e) => {
      e.stopPropagation();

      const realId = row.dataset.messageId;
      if (!realId || String(realId).startsWith("pending")) return;

      openDeleteConfirm(realId, row);
    };

    row.appendChild(delBtn);
  }

  // 7) 추가
  chatBody.appendChild(row);
}

/* ======================================================
   메시지 전송
====================================================== */
async function sendMessage(type, content) {
  if (!ROOM_ID || !CURRENT_USER || !content) return;

  const clientMsgId = genClientMsgId();
  PENDING_CLIENT_IDS.add(clientMsgId);

  // 1) UI 즉시 렌더(pending)
  renderMsg({
    id: `pending_${clientMsgId}`,
    clientMsgId,
    sender_id: CURRENT_USER.id,
    message_type: type,
    message: type === "text" ? content : null,
    file_url: type === "image" ? content : null,
    is_read: 0,
  });
  scrollBottom();

  
  // 2) 좌측 프리뷰 즉시 갱신
const preview = type === "image" ? "📷 이미지" : content;
updateLeftLastMsg(ROOM_ID, preview, ROOM_TYPE || "work");



  // 3) 서버 저장
  try {
const payload = {
  roomId: ROOM_ID,
  roomType: ROOM_TYPE || "work",
  message_type: type,
  message: type === "text" ? content : null,
  file_url: type === "image" ? content : null,
  clientMsgId,
};


    



    const res = await fetch(`${API}/chat/send-message`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await res.json().catch(() => null);

    if (data && data.success) {
      PENDING_CLIENT_IDS.delete(clientMsgId);
    } else {
      console.warn("❌ send-message failed:", data);
      PENDING_CLIENT_IDS.delete(clientMsgId);
    }
  } catch (e) {
    console.warn("❌ send-message network error:", e);
    PENDING_CLIENT_IDS.delete(clientMsgId);
  }
}

function sendText() {
  const text = (msgInput?.value || "").trim();
  if (!text) return;
  if (msgInput) msgInput.value = "";
  sendMessage("text", text);
}

/* ======================================================
   이미지 업로드 + 전송
====================================================== */
if (fileBtn && fileInput) {
  fileBtn.onclick = () => fileInput.click();

  fileInput.onchange = async () => {
    const file = fileInput.files?.[0];
    if (!file) return;

    const fd = new FormData();
    fd.append("image", file);

    try {
      const res = await fetch(`${API}/chat/upload-image`, {
        method: "POST",
        credentials: "include",
        body: fd,
      });

      const data = await res.json().catch(() => null);
      if (data && data.success && data.url) {
        await sendMessage("image", data.url);
      } else {
        console.warn("❌ upload-image failed:", data);
      }
    } catch (e) {
      console.warn("❌ upload-image network error:", e);
    } finally {
      fileInput.value = "";
    }
  };
}

/* ======================================================
   Socket.io
====================================================== */
function initSocket() {
  if (typeof window.io !== "function") {
    console.warn("❌ socket.io not loaded (window.io undefined)");
    return;
  }

  if (socket) {
    try { socket.disconnect(); } catch {}
    socket = null;
  }

  socket = window.io(API, {
    withCredentials: true,
    transports: ["polling", "websocket"],
    upgrade: true,
    reconnection: true,
    reconnectionAttempts: 20,
    reconnectionDelay: 800,
    reconnectionDelayMax: 3000,
    timeout: 10000,
  });

  function joinRoomIfNeeded() {
    if (!ROOM_ID) return;

    const roomType = ROOM_TYPE || "work";
    const roomId = ROOM_ID;

    socket.emit("chat:join", { roomType, roomId }, (ack) => {
      const ok =
        ack === true ||
        ack === "OK" ||
        (ack && typeof ack === "object" && ack.ok === true);

      console.log(
        "✅ chat:join ack =",
        ack,
        "parsed ok =",
        ok,
        "room =",
        `${roomType}:${roomId}`
      );
    });
  }

  let SYNC_LOCK = false;
  async function syncListAndBadges(reason = "") {
    if (SYNC_LOCK) return;
    SYNC_LOCK = true;

    try {
      await loadChatList();
      await applyRoomUnreadCounts();
      if (ROOM_ID) hideUnreadBadge(ROOM_ID);
      if (reason) console.log("🔄 syncListAndBadges:", reason);
    } catch (e) {
      console.warn("❌ syncListAndBadges fail:", reason, e);
    } finally {
      SYNC_LOCK = false;
    }
  }

  socket.on("connect", async () => {
    console.log("✅ socket connected:", socket.id, "ROOM_ID =", ROOM_ID);
    joinRoomIfNeeded();
    await syncListAndBadges("connect");
  });

  socket.on("reconnect", async (attempt) => {
    console.log("🔁 socket reconnected:", attempt, "ROOM_ID =", ROOM_ID);
    joinRoomIfNeeded();
    await syncListAndBadges("reconnect");
  });

  socket.on("connect_error", (e) => {
    console.warn("❌ socket connect_error:", e?.message || e);
  });

  socket.on("disconnect", (reason) => {
    console.warn("🔌 socket disconnected:", reason);
  });

  socket.on("chat:joined", (payload) => {
    console.log("✅ joined room payload =", payload);
  });

  socket.on("chat:notify", async (p) => {
    console.log("🔔 chat:notify:", p);
    await syncListAndBadges("notify");
  });

  // ✅ chat:message (roomType + roomId 기준)
  socket.on("chat:message", async (msg) => {
    if (!CURRENT_USER) return;

    const msgRoomId = safeStr(msg?.room_id || msg?.roomId);
    const msgRoomType = safeStr(msg?.room_type || msg?.roomType || "work");
    if (!msgRoomId) return;

    const preview =
      msg.message_type === "image"
        ? "📷 이미지"
        : (msg.message || msg.content || "");

    updateLeftLastMsg(msgRoomId, preview, msgRoomType);




const itemByKey = getChatItemByKey(msgRoomType, msgRoomId);
if (itemByKey) {
  const el = itemByKey.querySelector(".chat-last");
  if (el) el.textContent = preview || "";
}

    if (!getChatItemByKey(msgRoomType, msgRoomId) && !getChatItem(msgRoomId)) {
      await syncListAndBadges("message_room_not_in_list");
    }

    const curRoomId = safeStr(ROOM_ID);
    const curRoomType = safeStr(ROOM_TYPE || "work");

    if (!ROOM_ID || msgRoomId !== curRoomId || msgRoomType !== curRoomType) {
      await syncListAndBadges("message_not_current_room");
      return;
    }

    renderMsg(msg);
    scrollBottom();

    markRoomAsRead(ROOM_ID);
    hideUnreadBadge(ROOM_ID);
  });

  // ✅ room-deleted
  socket.on("chat:room-deleted", ({ roomId, roomType }) => {
    const rid = safeStr(roomId);
    const rtype = safeStr(roomType || "work");
    if (!rid) return;

    if (typeof markRoomDeleted === "function") {
      markRoomDeleted(rtype, rid);
    } else {
      DELETED_ROOMS.add(makeRoomKey(rtype, rid));
    }

    removeRoomFromUI(rid, rtype);

    const curRoomId = safeStr(ROOM_ID);
    const curRoomType = safeStr(ROOM_TYPE || "work");

    if (rid === curRoomId && rtype === curRoomType) {
      location.href = "/chat.html";
    }
  });

  // ✅ message delete
  socket.on("chat:delete", ({ messageId, roomId, roomType }) => {
    const rid = safeStr(roomId);
    const rtype = safeStr(roomType || "work");

    const curRoomId = safeStr(ROOM_ID);
    const curRoomType = safeStr(ROOM_TYPE || "work");

    if (rid && ROOM_ID && (rid !== curRoomId || rtype !== curRoomType)) return;

    const el = document.querySelector(
      `.msg-row[data-message-id="${safeStr(messageId)}"]`
    );
    if (el) el.remove();
  });

  // ✅ read
  socket.on("chat:read", ({ roomId, roomType }) => {
    const rid = safeStr(roomId);
    const rtype = safeStr(roomType || "work");

    const curRoomId = safeStr(ROOM_ID);
    const curRoomType = safeStr(ROOM_TYPE || "work");

    if (!ROOM_ID) return;
    if (rid !== curRoomId || rtype !== curRoomType) return;

    document.querySelectorAll(".msg-row.me .read-state").forEach((el) => {
      el.textContent = "읽음";
    });
  });
}


/* ======================================================
   이미지 모달
====================================================== */
function openImageModal(src) {
  if (!imgModal || !imgView) return;
  imgView.src = src;
  imgModal.style.display = "flex";
}

if (imgModal) {
  imgModal.onclick = () => {
    imgModal.style.display = "none";
    if (imgView) imgView.src = "";
  };
}

/* ======================================================
   실행
====================================================== */
(async function init() {
  await loadMe();

  await loadChatList();
  await applyRoomUnreadCounts();

  if (ROOM_ID) {
    await loadRoomInfo();
    await loadMessages();

    markRoomAsRead(ROOM_ID);
    hideUnreadBadge(ROOM_ID);
  } else {
    if (headerName && headerName.textContent === "Loading...") {
      headerName.textContent = "대화를 선택하세요";
    }
  }

  initSocket();
})();

/* ======================================================
   입력 이벤트
====================================================== */
if (sendBtn) sendBtn.onclick = sendText;

if (msgInput) {
  msgInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      sendText();
    }
  });
}
