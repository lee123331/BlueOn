async function handleBuy(serviceId) {
  const res = await fetch("/orders/create", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ serviceId })
  });

  const data = await res.json();

  // ✅ 1️⃣ 중복 입금 대기 주문
  if (!data.success && data.code === "DUPLICATE_PENDING") {
    alert("이미 입금 대기 중인 주문이 있습니다.\n해당 주문 페이지로 이동합니다.");
    location.href = `/order-pay.html?orderId=${data.orderId}`;
    return;
  }

  // ❌ 2️⃣ 진짜 실패
  if (!data.success) {
    alert(data.message || "주문 생성 실패");
    return;
  }

  // ✅ 3️⃣ 정상 주문 생성
  location.href = `/order-pay.html?orderId=${data.orderId}`;
}
