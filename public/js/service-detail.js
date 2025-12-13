async function handleBuy(serviceId) {
  try {
    const res = await fetch("/orders/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ serviceId })
    });

    /* -----------------------------
       네트워크/서버 레벨 오류
    ----------------------------- */
    if (!res.ok) {
      showToast("서버 통신에 실패했습니다. 잠시 후 다시 시도해 주세요.");
      return;
    }

    const data = await res.json();

    /* ---------------------------------
       1️⃣ 이미 입금 대기 중인 주문
    --------------------------------- */
    if (!data.success && data.code === "DUPLICATE_PENDING") {
      showToast(
        "이미 입금 대기 중인 주문이 있습니다.",
        "작업 확인하기",
        () => {
          // 🔥 나중에 완성할 작업 확인 페이지
          location.href = `/my-orders.html?orderId=${data.orderId}`;
        }
      );
      return;
    }

    /* ---------------------------------
       2️⃣ 기타 실패 (진짜 에러)
    --------------------------------- */
    if (!data.success) {
      showToast(data.message || "주문 생성 중 오류가 발생했습니다.");
      return;
    }

    /* ---------------------------------
       3️⃣ 정상 주문 생성
    --------------------------------- */
    location.href = `/order-pay.html?orderId=${data.orderId}`;

  } catch (err) {
    console.error("❌ handleBuy error:", err);
    showToast("예상치 못한 오류가 발생했습니다.");
  }
}
