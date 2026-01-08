// ✅ 채팅방 목록 (왼쪽 리스트용)
app.get("/chat/rooms", async (req, res) => {
  try {
    if (!req.session.user) {
      return res.json({ success: false, rooms: [] });
    }

    const userId = req.session.user.id;

    // service_chat_rooms: (id, service_id, user_id, expert_id, last_msg, updated_at)
    const [rows] = await db.query(
      `
      SELECT
        r.id AS roomId,
        r.last_msg,
        r.updated_at,

        -- 상대방 정보
        CASE
          WHEN r.user_id = ? THEN e.nickname
          ELSE u.nickname
        END AS nickname,
        CASE
          WHEN r.user_id = ? THEN e.avatar
          ELSE u.avatar
        END AS avatar,

        COALESCE(cu.count, 0) AS unread

      FROM service_chat_rooms r
      LEFT JOIN users u ON u.id = r.user_id
      LEFT JOIN users e ON e.id = r.expert_id
      LEFT JOIN chat_unread cu
        ON cu.room_id = r.id AND cu.user_id = ?

      WHERE r.user_id = ? OR r.expert_id = ?
      ORDER BY r.updated_at DESC
      `,
      [userId, userId, userId, userId, userId]
    );

    return res.json({ success: true, rooms: rows });
  } catch (err) {
    console.error("❌ /chat/rooms error:", err);
    return res.json({ success: false, rooms: [] });
  }
});
