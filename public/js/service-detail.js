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
  if (!data.success) {
    alert("주문 생성 실패");
    return;
  }

  // 🔥 입금 안내 페이지로 이동
  location.href = `/order-pay.html?orderId=${data.orderId}`;
}
