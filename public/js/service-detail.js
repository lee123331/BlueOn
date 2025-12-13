async function handleBuy(serviceId, expertId, price) {
  const res = await fetch("/orders/create", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({
      serviceId,
      expertId,
      price
    })
  });

  const data = await res.json();

  /* --------------------------------
     🔥 중복 pending 주문 처리
  -------------------------------- */
  if (!data.success && data.code === "DUPLICATE_PENDING") {
    alert("이미 입금 대기 중인 주문이 있습니다.\n해당 주문 페이지로 이동합니다.");
    location.href = `/order-pay.html?orderId=${data.orderId}`;
    return;
  }

  /* --------------------------------
     ❌ 기타 실패
  -------------------------------- */
  if (!data.success) {
    alert("주문 생성 실패");
    return;
  }

  /* --------------------------------
     ✅ 정상 주문 생성
  -------------------------------- */
  location.href = `/order-pay.html?orderId=${data.orderId}`;
}
