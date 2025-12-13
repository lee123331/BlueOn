async function handleBuy(serviceId) {
  try {
    const res = await fetch("/orders/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ serviceId })
    });

    // 네트워크 자체 실패
    if (!res.ok) {
      alert("서버 통신에 실패했습니다.");
      return;
    }

    const data = await res.json();

    /* ---------------------------------
       1️⃣ 이미 입금 대기 중인 주문
    --------------------------------- */
    if (!data.success && data.code === "DUPLICATE_PENDING") {
      alert(
        "이미 입금 대기 중인 주문이 있습니다.\n" +
        "해당 주문 페이지로 이동합니다."
      );
      location.href = `/order-pay.html?orderId=${data.orderId}`;
      return;
    }

    /* ---------------------------------
       2️⃣ 기타 실패 (진짜 에러)
    --------------------------------- */
    if (!data.success) {
      alert(data.message || "주문 생성 실패");
      return;
    }

    /* ---------------------------------
       3️⃣ 정상 주문 생성
    --------------------------------- */
    location.href = `/order-pay.html?orderId=${data.orderId}`;

  } catch (err) {
    console.error("❌ handleBuy error:", err);
    alert("예상치 못한 오류가 발생했습니다.");
  }
}
