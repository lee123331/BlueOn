// public/js/expert-tasks.js
console.log("🟦 expert-tasks.js loaded");

const API = "https://blueon.up.railway.app";

/* ===============================
   🔹 상태 한글 매핑
=============================== */
const STATUS_MAP = {
  start: "작업중",
  draft: "시안 제출",
  revise: "수정 진행",
  final: "최종 제출",
  done: "완료"
};

/* ===============================
   🔹 전문가 작업 리스트 로드
=============================== */
async function loadExpertTasks() {
  const taskList = document.getElementById("taskList");
  const doneTaskList = document.getElementById("doneTaskList");

  if (!taskList || !doneTaskList) {
    console.warn("⚠️ 작업 리스트 DOM이 없습니다.");
    return;
  }

  taskList.innerHTML = "";
  doneTaskList.innerHTML = "";

  try {
    const res = await fetch(`${API}/expert/tasks`, {
      credentials: "include"
    });

    if (!res.ok) throw new Error("서버 응답 오류");

    const data = await res.json();

    if (!data.success || !Array.isArray(data.tasks)) {
      throw new Error("잘못된 데이터");
    }

    if (data.tasks.length === 0) {
      taskList.innerHTML = `<div class="task-empty">아직 진행 중인 작업이 없습니다.</div>`;
      doneTaskList.innerHTML = `<div class="task-empty">완료된 작업이 없습니다.</div>`;
      return;
    }

    data.tasks.forEach((task) => {
      const item = document.createElement("div");
      item.className = "task-item";

      const thumb =
        task.main_image ||
        task.service_image ||
        "/assets/default_service.png";

      item.innerHTML = `
        <div class="task-left">
          <img class="task-thumb" src="${thumb}" alt="서비스 이미지">
          <div class="task-info">
            <div class="task-title">
              ${task.service_title || "서비스명 없음"}
            </div>
            <div class="task-user">
              구매자: ${task.buyer_name || "-"}
            </div>
          </div>
        </div>

        <div class="task-status">
          ${STATUS_MAP[task.status] || "진행중"}
        </div>

        <div class="task-date">
          ${(task.created_at || "").slice(0, 10)}
        </div>
      `;

      /* 🔥 클릭 → 작업 상세 페이지 */
      item.addEventListener("click", () => {
        if (!task.task_key) {
          alert("작업 키가 존재하지 않습니다.");
          return;
        }
        location.href = `/expert-task.html?task=${task.task_key}`;
      });

      // 상태에 따라 분리
      if (task.status === "done") {
        doneTaskList.appendChild(item);
      } else {
        taskList.appendChild(item);
      }
    });

    // 비어 있을 경우 메시지
    if (!taskList.children.length) {
      taskList.innerHTML = `<div class="task-empty">진행중인 작업이 없습니다.</div>`;
    }

    if (!doneTaskList.children.length) {
      doneTaskList.innerHTML = `<div class="task-empty">완료된 작업이 없습니다.</div>`;
    }

  } catch (err) {
    console.error("❌ 작업 리스트 로드 실패:", err);
    taskList.innerHTML = `<div class="task-empty">작업 정보를 불러오지 못했습니다.</div>`;
  }
}

/* ===============================
   🔹 DOM 로드 후 실행
=============================== */
document.addEventListener("DOMContentLoaded", loadExpertTasks);
