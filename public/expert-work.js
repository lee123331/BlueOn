console.log("🔥 expert-work.js 로딩됨");

const serviceList = document.getElementById("serviceList");

/* ======================================================
   샘플 데이터 (추후 서버 데이터로 교체)
====================================================== */
const orders = [
  {
    service_title: "쇼핑몰 상세페이지 제작",
    price: 35000,
    date: "2024-12-01",
    img: "/assets/sample.png",
    request: "브랜드 컬러는 파란색 계열로 부탁드립니다.\n모던하고 심플한 디자인 원합니다.",
    status: "ready",
  },
  {
    service_title: "로고 디자인",
    price: 120000,
    date: "2024-11-25",
    img: "/assets/sample.png",
    request: "라운드 느낌의 심벌 디자인 원합니다.",
    status: "working",
  }
];

/* ======================================================
   상태 카운트 반영
====================================================== */
function updateStatusCards() {
  document.getElementById("status-ready").textContent =
    orders.filter(o => o.status === "ready").length;

  document.getElementById("status-working").textContent =
    orders.filter(o => o.status === "working").length;

  document.getElementById("status-revise").textContent =
    orders.filter(o => o.status === "revise").length;

  document.getElementById("status-done").textContent =
    orders.filter(o => o.status === "done").length;
}

/* ======================================================
   서비스 카드 렌더링
====================================================== */
function renderOrders() {
  serviceList.innerHTML = "";

  orders.forEach((order, idx) => {
    const div = document.createElement("div");
    div.className = "service-card";

    div.innerHTML = `
      <div class="service-header">
        <img src="${order.img}">
        <div class="service-info">
          <div class="service-title">${order.service_title}</div>
          <div class="service-price">${order.price.toLocaleString()}원</div>
          <div class="service-date">주문일시: ${order.date}</div>
        </div>
      </div>

      <div class="request-box" onclick="toggleRequest(${idx})">
        <div class="request-title">📌 요청사항 펼치기</div>
        <div class="request-content" id="req-${idx}">
          ${order.request}
        </div>
      </div>

      <button class="start-btn">작업 시작하기</button>
    `;

    serviceList.appendChild(div);
  });
}

/* ======================================================
   요청사항 토글
====================================================== */
function toggleRequest(idx) {
  const content = document.getElementById("req-" + idx);
  content.style.display =
    content.style.display === "block" ? "none" : "block";
}

/* 초기 실행 */
updateStatusCards();
renderOrders();
