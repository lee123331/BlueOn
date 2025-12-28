// =======================
// 필요한 모듈 로드
// =======================
import axios from "axios";
import crypto from "crypto";
import express from "express";
import mysql from "mysql2/promise";
import cors from "cors";
import bcrypt from "bcrypt";
import session from "express-session";
import MySQLStoreImport from "express-mysql-session";

import multer from "multer";
import path from "path";
import fs from "fs";
import http from "http";
import { Server as SocketIOServer } from "socket.io";

const app = express();
// =======================
// 환경 변수 출력 확인
// =======================
console.log("SOLAPI_API_KEY =", process.env.SOLAPI_API_KEY);
console.log("SOLAPI_API_SECRET =", process.env.SOLAPI_API_SECRET);
console.log("PORT =", process.env.PORT);
console.log("SENDER_PHONE =", process.env.SENDER_PHONE);
console.log("🔍 MySQL Host:", process.env.DB_HOST);
console.log("🔍 MySQL User:", process.env.DB_USER);
console.log("🔍 MySQL Database:", process.env.DB_NAME);


const PORT = process.env.PORT || 3000;

function isAdmin(req) {
  if (!req.session.user) return false;
  return String(req.session.user.id) === String(process.env.ADMIN_USER_ID);
}


// =======================
// 공통 시간 문자열 생성 함수
// =======================
function nowStr() {
  return new Date()
    .toISOString()
    .slice(0, 19)
    .replace("T", " ");
}



/* ======================================================
   공통: DB_URL 파싱 함수 (1회 선언)
====================================================== */
function parseDbUrl(url) {
  try {
    const cleaned = url.replace("mysql://", "");
    const [auth, hostPart] = cleaned.split("@");
    const [user, password] = auth.split(":");
    const [hostWithPort, database] = hostPart.split("/");
    const [host, port] = hostWithPort.split(":");

    return { host, port, user, password, database };
  } catch (e) {
    console.error("❌ DB_URL 파싱 실패:", url, e);
    return null;
  }
}

/* ======================================================
   DB 연결 (Railway)
====================================================== */
const dbConf = parseDbUrl(process.env.DB_URL);

if (!dbConf) {
  console.error("❌ DB_URL이 올바르지 않습니다. Railway Variables 확인 필요.");
  process.exit(1);
}

console.log("🔗 DB 설정:", dbConf);

const db = await mysql.createPool({
  host: dbConf.host,
  port: dbConf.port,
  user: dbConf.user,
  password: dbConf.password,
  database: dbConf.database,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

console.log("✅ DB 연결 성공");

/* ======================================================
   미들웨어
====================================================== */
app.use(express.json({ limit: "30mb" }));
app.use(express.urlencoded({ extended: true, limit: "30mb" }));

app.use((req, res, next) => {
  console.log("📨 요청 도착:", req.method, req.url);
  next();
});

app.use(
  cors({
    origin: [
      "http://localhost:3000",
      "http://localhost:5173",
      "https://blueon.up.railway.app"
    ],
    credentials: true,
    allowedHeaders: ["Content-Type"],
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  })
);
/* ======================================================
   업로드 디렉토리 생성 (Railway Volume 용)
====================================================== */
const uploadBase = path.join(process.cwd(), "public/uploads");
if (!fs.existsSync(uploadBase)) {
  fs.mkdirSync(uploadBase, { recursive: true });
  console.log("📁 uploads 폴더 자동 생성됨");
}

/* ======================================================
   정적 파일 경로
====================================================== */
app.use("/uploads", express.static(path.join(process.cwd(), "public/uploads")));
app.use(express.static(path.join(process.cwd(), "public")));

/* ======================================================
   세션 (Railway + DB_URL)
====================================================== */
const MySQLStore = MySQLStoreImport(session);

const sessionStore = new MySQLStore({
  // 🔹 DB 연결 정보
  host: dbConf.host,
  port: dbConf.port,
  user: dbConf.user,
  password: dbConf.password,
  database: dbConf.database,

  // 🔹 세션 옵션
  expiration: 24 * 60 * 60 * 1000, // 1일
  createDatabaseTable: true,
  schema: {
    tableName: "sessions",
    columnNames: {
      session_id: "session_id",
      expires: "expires",
      data: "data",
    },
  },
});

const sessionMiddleware = session({
  name: "blueon.sid", // key ❌ → name ⭕
  secret: process.env.SESSION_SECRET || "blueon_secret",
  resave: false,
  saveUninitialized: false,
  store: sessionStore,
  cookie: {
    httpOnly: true,
    secure: false,      // Railway HTTPS면 true로 바꿔도 됨
    sameSite: "lax",
    maxAge: 1000 * 60 * 60 * 24,
  },
});

app.use(sessionMiddleware);

console.log("✅ 세션 스토어 적용 완료");


function getTaskKey(main, sub) {
  if (!main && !sub) return null;

  // 1) 브랜드 디자인 → 로고
  if (main === "brand_design" && ["로고 디자인", "브랜드 키비주얼"].includes(sub)) {
    return "task_logo";
  }

  // 2) 브랜드 디자인 → 상세페이지/배너/이미지
  if (main === "brand_design" && 
     ["상세페이지 제작", "배너 디자인", "브랜드 이미지 제작", "SNS 카드 뉴스"].includes(sub)) {
    return "task_visual";
  }

  // 3) 마케팅 범주
  if (main === "marketing") {
    return "task_story";
  }

  // 4) 쇼핑몰·웹 구축 범주
  if (main === "shop_build") {
    return "task_programming";
  }

  return null;
}

/* ======================================================
   업로드 디렉토리 생성
====================================================== */
function ensureDir(pathStr) {
  if (!fs.existsSync(pathStr)) fs.mkdirSync(pathStr, { recursive: true });
}
ensureDir("public/uploads");
ensureDir("public/uploads/services");

/* ======================================================
   Multer
====================================================== */
const avatarStorage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, "public/uploads"),
  filename: (_, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  },
});
const avatarUpload = multer({ storage: avatarStorage });

const serviceStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const userId = req.session.user.id;
    const dir = `public/uploads/services/${userId}`;
    ensureDir(dir);
    cb(null, dir);
  },
  filename: (_, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  },
});
const servicesUpload = multer({
  storage: serviceStorage,
  limits: {
    fieldSize: 10 * 1024 * 1024,
    fileSize: 10 * 1024 * 1024,
  },
});

/* ======================================================
   전문가 아바타 업로드 (Step1 전용)
====================================================== */
const expertAvatarStorage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, "public/uploads"),
  filename: (_, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(
      null,
      `expert-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`
    );
  },
});
const expertAvatarUpload = multer({ storage: expertAvatarStorage });

app.post(
  "/expert/upload-avatar",
  expertAvatarUpload.single("avatar"),
  (req, res) => {
    if (!req.file) {
      return res.json({ success: false, message: "파일 업로드 실패" });
    }
    const url = `/uploads/${req.file.filename}`;
    return res.json({ success: true, url });
  }
);
/* ======================================================
   🔵 닉네임 중복 체크 (전문가 등록 / 프로필 공용)
====================================================== */
app.get("/expert/check-nickname", async (req, res) => {
  try {
    const { nickname } = req.query;
    const myId = req.session.user?.id || null;

    if (!nickname) {
      return res.json({ success: false });
    }

    const [rows] = await db.query(
      `
      SELECT id
      FROM users
      WHERE nickname = ?
        AND id != ?
      LIMIT 1
      `,
      [nickname, myId]
    );

    return res.json({
      success: true,
      available: rows.length === 0
    });

  } catch (err) {
    console.error("❌ check-nickname error:", err);
    return res.status(500).json({ success: false });
  }
});

/* ======================================================
   🔵 현재 로그인 유저 정보
   GET /me
====================================================== */
app.get("/me", (req, res) => {
  if (!req.session.user) {
    return res.json({ success: false });
  }

  return res.json({
    success: true,
    user: {
      id: req.session.user.id,
      nickname: req.session.user.nickname,
      avatar_url: req.session.user.avatar_url,
      intro: req.session.user.intro || null,
      isExpert: req.session.user.isExpert || false
    }
  });
});
/* ======================================================
   🔵 전문가 등록 여부 확인
   GET /expert/is-registered
====================================================== */
app.get("/expert/is-registered", async (req, res) => {
  if (!req.session.user) {
    return res.json({ isExpert: false });
  }

  const userId = req.session.user.id;

  const [rows] = await db.query(
    "SELECT id FROM expert_profiles WHERE user_id = ? LIMIT 1",
    [userId]
  );

  return res.json({
    isExpert: rows.length > 0
  });
});

/* ======================================================
   JSON/JS 배열 자동 파서 (서비스 이미지용)
====================================================== */
function parseArray(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;

  try {
    return JSON.parse(raw);
  } catch {}

  try {
    return JSON.parse(raw.replace(/'/g, '"'));
  } catch {
    console.error("❌ 이미지 배열 파싱 실패:", raw);
    return [];
  }
}

/* 전문가 JSON 필드 안전 파서 (expert_profiles 전용) */
function safeJsonParse(str) {
  if (!str) return [];
  if (Array.isArray(str)) return str;
  try {
    return JSON.parse(str);
  } catch (e) {
    console.error("❌ JSON 파싱 실패 (expert_profiles):", e, "원본값:", str);
    return [];
  }
}

/* 서버 전용 안전 파서 (services.main_images 등) */
function parseImagesSafe(raw) {
  if (!raw) return [];

  if (Array.isArray(raw)) return raw;

  try {
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) return arr;
  } catch {}

  if (typeof raw === "string" && raw.includes(",")) {
    return raw
      .split(",")
      .map((v) => v.trim())
      .filter((v) => v.startsWith("/uploads/"));
  }

  if (typeof raw === "string" && raw.startsWith("/uploads/")) {
    return [raw];
  }

  return [];
}
/* ======================================================
   🧩 작업 채팅 컨텍스트 조회 (🔥 핵심 API)
   GET /api/task-chat/context?taskKey=xxx
====================================================== */
app.get("/api/task-chat/context", async (req, res) => {
  try {
    if (!req.session.user) {
      return res.status(401).json({
        success: false,
        message: "로그인 필요"
      });
    }

    const myId = req.session.user.id;
    const { taskKey } = req.query;

    if (!taskKey) {
      return res.status(400).json({
        success: false,
        message: "taskKey 누락"
      });
    }

    /* ======================================================
       1️⃣ 주문 + 구매자 + 서비스 정보 (🔥 핵심 JOIN)
    ====================================================== */
    const [[row]] = await db.query(
      `
      SELECT
        o.id           AS order_id,
        o.user_id      AS buyer_id,
        o.expert_id,
        o.room_id,
        o.task_key,

        u.nickname     AS buyer_nickname,

        s.title        AS service_title
      FROM orders o
      JOIN users u     ON u.id = o.user_id
      JOIN services s  ON s.id = o.service_id
      WHERE o.task_key = ?
      LIMIT 1
      `,
      [taskKey]
    );

    if (!row) {
      return res.status(404).json({
        success: false,
        message: "주문 없음"
      });
    }

    /* ======================================================
       2️⃣ 접근 권한 체크
    ====================================================== */
    const isBuyer  = myId === row.buyer_id;
    const isExpert = myId === row.expert_id;

    if (!isBuyer && !isExpert) {
      return res.status(403).json({
        success: false,
        message: "접근 권한 없음"
      });
    }

    /* ======================================================
       3️⃣ 채팅방 생성 보장
    ====================================================== */
    let roomId = row.room_id;

    if (!roomId) {
      const now = nowStr();

      const [result] = await db.query(
        `
        INSERT INTO chat_rooms
        (order_id, user1_id, user2_id, room_type, created_at)
        VALUES (?, ?, ?, 'task', ?)
        `,
        [
          row.order_id,
          row.buyer_id,
          row.expert_id,
          now
        ]
      );

      roomId = result.insertId;

      await db.query(
        `UPDATE orders SET room_id = ? WHERE id = ?`,
        [roomId, row.order_id]
      );
    }

    /* ======================================================
       4️⃣ 상대방 계산
    ====================================================== */
    const targetId = isBuyer ? row.expert_id : row.buyer_id;

    /* ======================================================
       5️⃣ ✅ 최종 context 응답 (🔥 여기서 해결됨)
    ====================================================== */
    return res.json({
      success: true,
      context: {
        taskKey,
        roomId,
        myId,
        role: isBuyer ? "buyer" : "expert",
        targetId,

        serviceTitle: row.service_title,

        buyer: {
          id: row.buyer_id,
          nickname: row.buyer_nickname
        }
      }
    });

  } catch (err) {
    console.error("❌ task-chat context error:", err);
    res.status(500).json({
      success: false,
      message: "서버 오류"
    });
  }
});

/* ======================================================
   🧩 작업 채팅 메시지 조회
   GET /api/task-chat/messages?roomId=123
====================================================== */
app.get("/api/task-chat/messages", async (req, res) => {
  try {
    if (!req.session.user) {
      return res.status(401).json({ success: false });
    }

    const myId = req.session.user.id;
    const { roomId } = req.query;

    if (!roomId) {
      return res.status(400).json({ success: false });
    }

    const [[room]] = await db.query(
      `
      SELECT user1_id, user2_id
      FROM chat_rooms
      WHERE id = ?
      `,
      [roomId]
    );

    if (!room) {
      return res.status(403).json({ success: false });
    }

    // ✅ 당사자 체크만 한다 (핵심)
    if (myId !== room.user1_id && myId !== room.user2_id) {
      return res.status(403).json({ success: false });
    }

    const [messages] = await db.query(
      `
      SELECT
        id,
        sender_id,
        message,
        created_at
      FROM chat_messages
      WHERE room_id = ?
      ORDER BY id ASC
      `,
      [roomId]
    );

    return res.json({ success: true, messages });

  } catch (err) {
    console.error("❌ task-chat messages error:", err);
    res.status(500).json({ success: false });
  }
});

/* ======================================================
   🔵 Socket.io 서버 생성
====================================================== */
const httpServer = http.createServer(app);

const io = new SocketIOServer(httpServer, {
   transports: ["websocket"], // 🔥 이거 반드시
  cors: {
    origin: [
      "http://localhost:3000",
      "http://localhost:5173",
      "https://blueon.up.railway.app"
    ],
    credentials: true,
  },
});
// 🔥 Express 세션을 Socket.io에 연결 (핵심)
io.use((socket, next) => {
  sessionMiddleware(socket.request, {}, next);
});


/* ------------------ 회원가입 ------------------ */
app.post("/signup", async (req, res) => {
  try {
    const { email, password, phone } = req.body;

    // 1) 이메일 중복 체크
    const [exist] = await db.execute(
      "SELECT id FROM users WHERE email = ?",
      [email]
    );

    if (exist.length > 0) {
      return res
        .status(409)
        .json({ success: false, message: "이미 가입된 이메일입니다." });
    }

    // 2) 전화번호 형식 검사
    if (!/^01[0-9]{8,9}$/.test(phone)) {
      return res.status(400).json({
        success: false,
        message: "휴대폰 번호 형식이 올바르지 않습니다.",
      });
    }

    // 3) 비밀번호 해시
    const hashedPw = await bcrypt.hash(password, 10);

    // 4) id 직접 생성
    const [[row]] = await db.query(
  "SELECT IFNULL(MAX(id), 0) + 1 AS newId FROM users"
);
const newId = row.newId;


    // 5) 저장 (created_at + updated_at 모두 포함)
const now = nowStr();

await db.execute(
  `
  INSERT INTO users 
  (id, provider, provider_id, email, password, phone, created_at, updated_at)
  VALUES (?, 'local', ?, ?, ?, ?, ?, ?)
  `,
  [newId, email, email, hashedPw, phone, now, now]
);



    return res.json({ success: true });

  } catch (err) {
    console.error("SIGNUP ERROR:", err);
    return res.status(500).json({ success: false });
  }
});

/* ------------------ 로그인 ------------------ */
app.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const [rows] = await db.query("SELECT * FROM users WHERE email=?", [email]);
    if (!rows.length)
      return res.json({ success: false, message: "이메일 없음" });

    const user = rows[0];
    const ok = await bcrypt.compare(password, user.password);
    if (!ok)
      return res.json({ success: false, message: "비밀번호 불일치" });

    const [expertRows] = await db.query(
      "SELECT id FROM expert_profiles WHERE user_id=?",
      [user.id]
    );

    req.session.user = {
      id: user.id,
      email: user.email,
      nickname: user.nickname,
      intro: user.intro,
      avatar_url: user.avatar_url,
      isExpert: expertRows.length > 0,
    };

    res.json({ success: true, user: req.session.user });
  } catch (e) {
    console.error("login error:", e);
    res.status(500).json({ success: false });
  }
});

/* ============================================
   GET /services/list
============================================ */
app.get("/services/list", async (req, res) => {
  try {
    const { sub } = req.query;

    console.log("📌 요청 sub 값:", req.query.sub);

    if (!sub) {
      return res.json({
        success: false,
        message: "sub 파라미터가 필요합니다.",
      });
    }

    const subList = sub.split(",").map((s) => s.trim());
    const placeholders = subList.map(() => "?").join(",");

    const [rows] = await db.query(
      `SELECT 
         id,
         title,
         price_basic,
         main_images,
         sub_category
       FROM services
       WHERE sub_category IN (${placeholders})
       ORDER BY id DESC`,
      subList
    );

    console.log("📌 DB 결과 sub_category:", rows.map((r) => r.sub_category));

    rows.forEach((r) => {
      r.main_images = parseImagesSafe(r.main_images);
    });

    return res.json({ success: true, services: rows });
  } catch (err) {
    console.error("services list error:", err);
    res.json({ success: false });
  }
});


/* ------------------ 프로필 업데이트 ------------------ */
app.post(
  "/profile/update",
  avatarUpload.single("avatar"),
  async (req, res) => {
    try {
      if (!req.session.user) return res.json({ success: false });

      const userId = req.session.user.id;
      let avatar = req.session.user.avatar_url;
      if (req.file) avatar = `/uploads/${req.file.filename}`;

      await db.query(
        "UPDATE users SET nickname=?, intro=?, avatar_url=? WHERE id=?",
        [req.body.nickname, req.body.intro, avatar, userId]
      );

      req.session.user.nickname = req.body.nickname;
      req.session.user.intro = req.body.intro;
      req.session.user.avatar_url = avatar;

      res.json({ success: true });
    } catch (e) {
      console.error("profile update error:", e);
      res.status(500).json({ success: false });
    }
  }
);

/* ------------------ 서비스 등록 ------------------ */
app.post(
  "/services/create",

  // 1️⃣ 세션 검사
  (req, res, next) => {
    if (!req.session.user) {
      return res.status(401).json({
        success: false,
        message: "로그인이 필요합니다.",
      });
    }
    next();
  },

  // 2️⃣ multer
  servicesUpload.fields([
    { name: "mainImages", maxCount: 4 },
    { name: "detailImages", maxCount: 8 },
  ]),

  // 3️⃣ 등록 처리
  async (req, res) => {
    try {
      const userId = req.session.user.id;
      const b = req.body;

      /* ==========================================================
         🔥 0) 신규 서비스 ID 생성 (AUTO_INCREMENT 없으므로 필수)
      ========================================================== */
      const [row] = await db.query(
        "SELECT IFNULL(MAX(id), 0) + 1 AS newId FROM services"
      );
      const newId = row[0].newId;



      /* ==========================================================
         🔥 1) taskKey 계산
      ========================================================== */
      const taskKey = getTaskKey(b.mainCategory, b.subCategory);



      /* ==========================================================
         🔥 2) 이미지 경로 목록 생성
      ========================================================== */
      const mainImgs = (req.files["mainImages"] || []).map(
        (f) => `/uploads/services/${userId}/${f.filename}`
      );
      const detailImgs = (req.files["detailImages"] || []).map(
        (f) => `/uploads/services/${userId}/${f.filename}`
      );



      /* ==========================================================
         🔥 3) 가격/기간/제공 항목 처리 (단일 or 패키지 BASIC)
      ========================================================== */
      let priceBasicValue = b.priceBasic || null;
      let durationValue = b.duration || null;
      let revisionValue = b.revisionCount || null;
      let offerItemsValue = b.offerItems || null;

      if (b.isPackageMode === "1" && b.packageJson) {
        try {
          const pkg = JSON.parse(b.packageJson);
          priceBasicValue = pkg.BASIC.price || null;
          durationValue = pkg.BASIC.duration || null;
          revisionValue = pkg.BASIC.revision || null;
          offerItemsValue = pkg.BASIC.desc || null;
        } catch (err) {
          console.log("❗ 패키지 JSON 파싱 실패:", err);
        }
      }



      const now = nowStr();

await db.query(
  `
  INSERT INTO services
  (
    id,
    user_id, title, main_category, sub_category, keywords,
    price_basic, duration, description, process, customer_request,
    main_images, detail_images, created_at, updated_at,
    brand_concept, revision_count, offer_items,
    is_package_mode, package_json,
    task_key
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
  [
    newId,                    // ⭐ 직접 생성한 ID
    userId,
    b.title,
    b.mainCategory,
    b.subCategory,
    b.keywords,
    priceBasicValue,
    durationValue,
    b.description,
    b.process,
    b.customerRequest,
    JSON.stringify(mainImgs),
    JSON.stringify(detailImgs),
    now,                       // ✅ created_at
    now,                       // ✅ updated_at
    b.brandConcept || null,
    revisionValue,
    offerItemsValue,
    b.isPackageMode || 0,
    b.packageJson || null,
    taskKey,
  ]
);




      /* ==========================================================
         🔥 5) 응답
      ========================================================== */
      res.json({ success: true, serviceId: newId });

    } catch (e) {
      console.error("service create error:", e);
      res.status(500).json({ success: false });
    }
  }
);

/* ------------------ 전문가 등록 임시 저장 (세션) ------------------ */
app.post("/expert/save-step", (req, res) => {
  try {
    if (!req.session.user) {
      return res.json({ success: false, message: "로그인 필요" });
    }

    const { step, data } = req.body;
    if (!step) {
      return res.json({ success: false, message: "step 누락" });
    }

    if (!req.session.expertDraft) req.session.expertDraft = {};
    req.session.expertDraft[`step${step}`] = data;

    req.session.save(() => {
      return res.json({ success: true });
    });
  } catch (err) {
    console.error("/expert/save-step error:", err);
    res.status(500).json({ success: false });
  }
});

/* ------------------ 전문가 프로필 상세 불러오기 ------------------ */
app.get("/expert/profile/:id", async (req, res) => {
  try {
    const userId = req.params.id;

    const [[user]] = await db.query(
      "SELECT id, name, nickname, intro, avatar_url FROM users WHERE id=?",
      [userId]
    );

    if (!user) {
      return res.status(404).json({ success: false, message: "유저 없음" });
    }

    const [[expert]] = await db.query(
      "SELECT * FROM expert_profiles WHERE user_id=?",
      [userId]
    );

    // 전문가 등록 안 된 경우 → 기본 유저 정보 반환
    if (!expert) {
      return res.json({
        success: true,
        profile: {
          ...user,
          avatar_url: user.avatar_url || "/assets/default_profile.png",
          isExpert: false,
        },
      });
    }

    const finalAvatar =
      expert.avatar_url || user.avatar_url || "/assets/default_profile.png";

    res.json({
      success: true,
      profile: {
        id: user.id,
        user_id: user.id,
        name: user.name,
        nickname: expert.nickname || user.nickname,
        intro: expert.intro || user.intro,

        avatar_url: finalAvatar,

        main_category: expert.main_category,
        sub_category: expert.sub_category,

        total_experience: expert.total_experience,
        careers: safeJsonParse(expert.careers_json),
        skills_json: safeJsonParse(expert.skills_json),
        tools: safeJsonParse(expert.tools_json),
        certificates: safeJsonParse(expert.certificates_json),
        styles: safeJsonParse(expert.styles_json),

        strength: expert.strength,
        story_work: expert.story_work,
        story_care: expert.story_care,
        story_brand: expert.story_brand,
        story_goal: expert.story_goal,

        solutions: expert.solutions || "",
        skills: expert.skills || "",
        projects: safeJsonParse(expert.projects),
        brand_story: expert.brand_story || "",

        bank_name: expert.bank_name,
        account_holder: expert.account_holder,
        account_number: expert.account_number,

        created_at: expert.created_at,
        updated_at: expert.updated_at,

        isExpert: true,
      },
    });
  } catch (err) {
    console.error("expert profile load error:", err);
    res.status(500).json({ success: false });
  }
});

/* ------------------ 전문가 최종 등록 ------------------ */
app.post("/expert/submit", async (req, res) => {
  try {
    if (!req.session.user) {
      return res.json({ success: false, message: "로그인이 필요합니다." });
    }

    const userId = req.session.user.id;
    const { step1, step2, step3, step4 } = req.body;

    /* ------------------ Step1 체크 ------------------ */
    if (!step1 || !step1.nickname) {
      return res.json({
        success: false,
        message: "1단계 정보가 부족합니다.",
      });
    }

    /* ------------------ Step1 데이터 ------------------ */
    const nickname = step1.nickname || null;
    const intro = step1.intro || null;
    const avatar_url = step1.avatarUrl || req.session.user.avatar_url || null;
    const main_category = step1.topCategory || null;
    const sub_category = step1.subCategory || null;

    /* ------------------ Step2 데이터 ------------------ */
    const total_experience = step2?.total_experience || 0;
    const careers_json = step2?.careers || [];

    /* ------------------ Step3 데이터 ------------------ */
    const skills_json = step3?.selectedSkills || [];
    const tools_json = step3?.toolSkills || [];
    const certificates_json = step3?.certificates || [];
    const styles_json = step3?.styles || [];
    const strength = step3?.strength || "";

    /* ------------------ Step4 데이터 ------------------ */
    const story_work = step4?.work || "";
    const story_care = step4?.care || "";
    const story_brand = step4?.brand || "";
    const story_goal = step4?.goal || "";
    const solutions = step4?.solutions || "";
    const skills_text = step4?.skills || "";
    const projects = step4?.projects || [];
    const brand_story = step4?.brandStory || "";

    /* ------------------ 은행 정보 ------------------ */
    const bankName = req.body.bankName || null;
    const accountHolder = req.body.accountHolder || null;
    const accountNumber = req.body.accountNumber || null;

    /* ------------------ 기존 전문가 프로필 여부 체크 ------------------ */
 const [exist] = await db.query(
  "SELECT id FROM expert_profiles WHERE user_id=?",
  [userId]
);

const now = nowStr();

if (exist.length === 0) {
  // 🔹 신규 등록
  await db.query(
    `
    INSERT INTO expert_profiles
    (
      user_id, nickname, intro, avatar_url,
      main_category, sub_category,
      total_experience, careers_json,
      skills_json, tools_json, certificates_json, styles_json,
      strength,
      story_work, story_care, story_brand, story_goal,
      solutions, skills, projects, brand_story,
      bank_name, account_holder, account_number,
      created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      userId,
      nickname,
      intro,
      avatar_url,
      main_category,
      sub_category,
      total_experience,
      JSON.stringify(careers_json),
      JSON.stringify(skills_json),
      JSON.stringify(tools_json),
      JSON.stringify(certificates_json),
      JSON.stringify(styles_json),
      strength,
      story_work,
      story_care,
      story_brand,
      story_goal,
      solutions,
      skills_text,
      JSON.stringify(projects),
      brand_story,
      bankName,
      accountHolder,
      accountNumber,
      now,
      now
    ]
  );
} else {
  // 🔹 수정
  await db.query(
    `
    UPDATE expert_profiles SET
      nickname=?,
      intro=?,
      avatar_url=?,
      main_category=?,
      sub_category=?,
      total_experience=?,
      careers_json=?,
      skills_json=?,
      tools_json=?,
      certificates_json=?,
      styles_json=?,
      strength=?,
      story_work=?,
      story_care=?,
      story_brand=?,
      story_goal=?,
      solutions=?,
      skills=?,
      projects=?,
      brand_story=?,
      bank_name=?,
      account_holder=?,
      account_number=?,
      updated_at=?
    WHERE user_id=?
    `,
    [
      nickname,
      intro,
      avatar_url,
      main_category,
      sub_category,
      total_experience,
      JSON.stringify(careers_json),
      JSON.stringify(skills_json),
      JSON.stringify(tools_json),
      JSON.stringify(certificates_json),
      JSON.stringify(styles_json),
      strength,
      story_work,
      story_care,
      story_brand,
      story_goal,
      solutions,
      skills_text,
      JSON.stringify(projects),
      brand_story,
      bankName,
      accountHolder,
      accountNumber,
      now,
      userId
    ]
  );
}


    /* =============================================================
       🔥 전문가 등록 인증 처리 — 핵심 2개
    ============================================================= */

    // 1) DB 업데이트
    await db.query("UPDATE users SET is_expert = 1 WHERE id=?", [userId]);

    // 2) 세션 즉시 반영 → 새로고침 없이도 전문가 메뉴 표시됨
    req.session.user.isExpert = true;


    return res.json({ success: true });

  } catch (err) {
    console.error("/expert/submit error:", err);
    return res.status(500).json({ success: false });
  }
});


/* ------------------ 전문가 서비스 목록 조회 ------------------ */
app.get("/expert/my-services", async (req, res) => {
  try {
    if (!req.session.user) {
      return res.json({ success: false, message: "로그인이 필요합니다." });
    }

    const userId = req.session.user.id;

    const [rows] = await db.query(
      `
      SELECT 
        id,
        title,
        price_basic,
        main_images,
        sub_category
      FROM services
      WHERE user_id = ?
      ORDER BY id DESC
      `,
      [userId]
    );

    return res.json({
      success: true,
      services: rows,
    });

  } catch (err) {
    console.error("❌ my-services 오류:", err);
    return res.json({
      success: false,
      message: "서비스 목록을 불러올 수 없습니다.",
    });
  }
});
/* ------------------ 로그인 유저 정보 ------------------ */
app.get("/auth/me", async (req, res) => {
  try {
    // 로그인 안 됨
    if (!req.session.user) {
      return res.json({ success: false, user: null });
    }

    const userId = req.session.user.id;

    const [[row]] = await db.query(
      `
      SELECT 
        u.id,
        u.email,
        u.nickname,
        u.intro,
        u.avatar_url,
        CASE WHEN ep.id IS NOT NULL THEN 1 ELSE 0 END AS is_expert
      FROM users u
      LEFT JOIN expert_profiles ep
        ON ep.user_id = u.id
      WHERE u.id = ?
      LIMIT 1
      `,
      [userId]
    );

    if (!row) {
      return res.json({ success: false, user: null });
    }

    // 🔵 세션 동기화
    req.session.user.nickname   = row.nickname;
    req.session.user.intro      = row.intro;
    req.session.user.avatar_url = row.avatar_url;
    req.session.user.isExpert   = row.is_expert === 1;

    return res.json({
      success: true,
      user: {
        id        : row.id,
        email     : row.email,
        nickname  : row.nickname || null,
        intro     : row.intro || null,
        avatar_url: row.avatar_url || null,
        isExpert  : row.is_expert === 1,
      },
    });

  } catch (err) {
    console.error("❌ /auth/me error:", err);
    return res.json({ success: false, user: null });
  }
});

/* ------------------ 서비스 상세 불러오기 ------------------ */
app.get("/services/:id", async (req, res) => {
  try {
    const id = req.params.id;

    const [[svc]] = await db.query(
      "SELECT * FROM services WHERE id=?",
      [id]
    );

    if (!svc) {
      return res.status(404).json({
        success: false,
        message: "서비스 없음",
      });
    }

    const safeArrayParse = (val) => {
      if (!val) return [];
      if (Array.isArray(val)) return val;
      try {
        return JSON.parse(val);
      } catch {}
      if (typeof val === "string" && val.startsWith("/uploads/")) return [val];
      return [];
    };

    const safeJsonParseLocal = (val) => {
      if (!val) return null;
      if (typeof val === "object") return val;
      try {
        return JSON.parse(val);
      } catch {
        return null;
      }
    };

    svc.main_images = safeArrayParse(svc.main_images);
    svc.detail_images = safeArrayParse(svc.detail_images);
    svc.package_json = safeJsonParseLocal(svc.package_json);

    const [[expert]] = await db.query(
      "SELECT id, user_id, nickname, intro, avatar_url FROM expert_profiles WHERE user_id=?",
      [svc.user_id]
    );

    // ⭐⭐⭐ 핵심: task_key를 프론트에 전달해야 진행률이 작동한다
    return res.json({
      success: true,
      service: {
        ...svc,
        task_key: svc.task_key,   // 🔥 반드시 필요
      },
      expert: expert || null,
    });

  } catch (err) {
    console.error("service detail error:", err);
    return res.status(500).json({
      success: false,
      message: "서버 오류 발생",
    });
  }
});


/* ============================================
   🔵 서비스 구매 카운트 증가 API
============================================ */
app.post("/services/:id/buy-count", async (req, res) => {
  try {
    const serviceId = req.params.id;

    console.log("📩 [buy-count] 요청 들어옴:", serviceId);

    await db.query(
      "UPDATE services SET buy_count = buy_count + 1 WHERE id = ?",
      [serviceId]
    );

    const [[row]] = await db.query(
      "SELECT buy_count FROM services WHERE id = ?",
      [serviceId]
    );

    return res.json({
      success: true,
      buy_count: row.buy_count,
    });
  } catch (err) {
    console.error("❌ buy-count error:", err);
    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});
app.post("/notice/portfolio-request", async (req, res) => {
  try {
    if (!req.session.user) {
      return res.json({ success: false, message: "로그인이 필요합니다." });
    }

    const { expertId, serviceTitle, taskKey = null } = req.body; // taskKey는 있으면 받고, 없으면 null
    const requesterId = req.session.user.id;

    if (!expertId) {
      return res.json({ success: false, message: "expertId가 없습니다." });
    }

    // 🚫 전문가 본인이 자기 서비스에서 누른 경우 → 알림 생성 안 함
    if (Number(expertId) === Number(requesterId)) {
      return res.json({
        success: false,
        message: "본인이 요청한 포트폴리오에는 알림이 생성되지 않습니다."
      });
    }

    const userName = req.session.user.nickname || "유저";
    const message = `${userName}님이 '${serviceTitle}' 서비스에서 포트폴리오를 요청했습니다.`;

    // ✅ 여기서 진짜로 DB 저장
    await createNotice({
      targetUserId: expertId,
      message,
      type: "trade",
      taskKey,             // 포트폴리오 요청은 taskKey 없으면 null이라도 OK
      fromUser: requesterId
    });

    // ✅ 실시간 알림도 원하면
    io.to(`user:${expertId}`).emit("notice:new", {
      type: "trade",
      message,
      task_key: taskKey
    });

    return res.json({ success: true });

  } catch (err) {
    console.error("portfolio request notice error:", err);
    return res.json({ success: false });
  }
});




async function createNotice({
  targetUserId,
  message,
  type = "trade",
  taskKey = null,
  roomId = null,
  fromUser = null
}) {
  if (!targetUserId || !message) return;

  try {
    await db.query(
      `
      INSERT INTO notices
      (
        user_id,
        message,
        type,
        is_read,
        created_at,
        room_id,
        from_user,
        task_key
      )
      VALUES (?, ?, ?, 0, ?, ?, ?, ?)
      `,
      [
        targetUserId,
        message,
        type,
        nowStr(),   // 🔥 문자열 시간
        roomId,
        fromUser,
        taskKey
      ]
    );
  } catch (err) {
    console.error("❌ createNotice error:", err);
  }
}

/* =======================================================
   🔔 전문가 알림 목록 (거래/시스템 분리)
   GET /notice/list?type=trade
   GET /notice/list?type=system
======================================================= */
app.get("/notice/list", async (req, res) => {
  try {
    // 🔴 캐시 완전 차단
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");

    if (!req.session.user) {
      return res.json({ success: false, notices: [] });
    }

    const userId = req.session.user.id;
    const type = req.query.type || "trade";

    const [rows] = await db.query(
      `
      SELECT
        id,
        message,
        type,
        room_id,
        from_user,
        task_key,
        created_at,
        is_read
      FROM notices
      WHERE user_id = ?
        AND type = ?
      ORDER BY id DESC
      `,
      [userId, type]
    );

    return res.json({
      success: true,
      notices: rows
    });

  } catch (err) {
    console.error("❌ notice list error:", err);
    return res.json({ success: false, notices: [] });
  }
});


/* =======================================================
   🔢 안 읽은 알림 개수 조회
======================================================= */
app.get("/notice/unread-count", async (req, res) => {
  try {
    if (!req.session.user) {
      return res.json({ success: false, count: 0 });
    }

    const userId = req.session.user.id;

    const [[row]] = await db.query(
      "SELECT COUNT(*) AS cnt FROM notices WHERE user_id=? AND is_read=0",
      [userId]
    );

    return res.json({
      success: true,
      count: row.cnt
    });

  } catch (err) {
    console.error("unread-count error:", err);
    return res.json({ success: false, count: 0 });
  }
});
/* ======================================================
   🔔 알림 전체 읽음 처리
====================================================== */
app.post("/notice/read-all", async (req, res) => {
  try {
    if (!req.session.user) {
      return res.json({ success: false });
    }

    const userId = req.session.user.id;

    await db.query(
      "UPDATE notices SET is_read = 1 WHERE user_id = ?",
      [userId]
    );

    return res.json({ success: true });
  } catch (err) {
    console.error("notice read-all error:", err);
    return res.json({ success: false });
  }
});

/* ============================================
   POST /brand/save  ▶ 브랜드 설계 저장
============================================ */
app.post("/brand/save", async (req, res) => {
  try {
    if (!req.session.user) {
      return res.json({ success: false, message: "로그인이 필요합니다." });
    }

    console.log("🔥 세션 유저:", req.session.user);
    console.log("🔥 req.body:", req.body);

    const userId = req.session.user.id;
    console.log("🔥 userId:", userId);

    const {
      keywords,
      story,
      concept,
      tone_tags,
      target_customer,
      spread_tags,
      expand_plan,
    } = req.body;

    await db.query(
      `INSERT INTO brand_plans 
      (user_id, keywords, story, concept, tone_tags, target_customer, spread_tags, expand_plan)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        userId,
        JSON.stringify(keywords),
        story,
        concept,
        JSON.stringify(tone_tags),
        target_customer,
        JSON.stringify(spread_tags),
        expand_plan,
      ]
    );

    return res.json({ success: true });
  } catch (err) {
    console.error("❌ 브랜드 설계 저장 오류:", err);
    return res.json({ success: false, message: "서버 오류 발생" });
  }
});

/* ======================================================
   GET /brand/check
====================================================== */
app.get("/brand/check", async (req, res) => {
  try {
    if (!req.session.user) {
      return res.json({ hasPlan: false });
    }

    const userId = req.session.user.id;

    const [rows] = await db.query(
      "SELECT id FROM brand_plans WHERE user_id=? LIMIT 1",
      [userId]
    );

    return res.json({ hasPlan: rows.length > 0 });
  } catch (err) {
    console.error("/brand/check error:", err);
    return res.status(500).json({ hasPlan: false });
  }
});
/* ------------------ 로그아웃 ------------------ */
app.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("blueon.sid");
    res.json({ success: true });
  });
});

/* 디버그용 테스트 라우트 */
app.post("/__test", (req, res) => {
  console.log("🔥 /__test 라우트 도착함");
  res.json({ ok: true });
});




/* ======================================================
   🔵 일반 유저 프로필 조회
   GET /users/profile/:id
====================================================== */
app.get("/users/profile/:id", async (req, res) => {
  try {
    const userId = req.params.id;

    const [[user]] = await db.query(
      `SELECT id, name, nickname, avatar_url 
       FROM users 
       WHERE id = ?`,
      [userId]
    );

    if (!user) {
      return res.json({ success: false, message: "유저 없음" });
    }

    return res.json({
      success: true,
      user: {
        id: user.id,
        name: user.name,
        nickname: user.nickname,
        avatar: user.avatar_url || "/assets/default_profile.png",
      }
    });

  } catch (err) {
    console.error("/users/profile error:", err);
    return res.json({
      success: false,
      message: "서버 오류"
    });
  }
});
/* ======================================================
   🔵 Socket.io (보안 강화 + 정상 구조)
====================================================== */
io.on("connection", (socket) => {
  try {
    console.log("🟢 Socket connected:", socket.id);

    const session = socket.request.session;
    const user = session?.user;

    /* ======================================================
       0️⃣ 비로그인 소켓도 허용 (헤더 알림용)
       - ❌ 여기서 disconnect 하면 안 됨
    ====================================================== */
    if (!user) {
      console.log("ℹ️ 비로그인/헤더 소켓 허용:", socket.id);

      socket.on("disconnect", () => {
        console.log("🔴 Header socket disconnected:", socket.id);
      });

      return; // ⚠️ 여기서 종료 (채팅/관리자 기능은 안 붙임)
    }

    /* ======================================================
       1️⃣ 로그인 유저 개인 room
    ====================================================== */
    socket.join(`user:${user.id}`);
    console.log(`➡ user:${user.id} 방 입장`);

  /* ======================================================
   2️⃣ 관리자 room 연결 (서버 세션 기준)
====================================================== */
const ADMIN_ID = String(process.env.ADMIN_USER_ID || "");

if (ADMIN_ID && String(user.id) === ADMIN_ID) {
  socket.join("admin");

  console.log(
    `👑 관리자 소켓 연결됨 | userId=${user.id} | socket=${socket.id}`
  );
}

    /* ======================================================
       3️⃣ 채팅 관련 이벤트 (로그인 유저만)
    ====================================================== */

    /* 채팅방 입장 */
    socket.on("chat:join", (roomId) => {
      if (!roomId) return;
      socket.join(String(roomId));
      console.log(`📌 chat:join → room ${roomId}`);
    });

    /* typing 표시 */
    socket.on("chat:typing", ({ roomId, userId, isTyping }) => {
      socket.to(String(roomId)).emit("chat:typing", {
        roomId,
        userId,
        isTyping,
      });
    });

    /* 읽음 표시 */
    socket.on("chat:read", ({ roomId, userId }) => {
      socket.to(String(roomId)).emit("chat:read", { roomId, userId });
    });

    /* 메시지 삭제 */
    socket.on("chat:delete", ({ roomId, messageId }) => {
      socket.to(String(roomId)).emit("chat:delete", { messageId });
    });

    /* ======================================================
       4️⃣ 연결 종료
    ====================================================== */
    socket.on("disconnect", () => {
      console.log("🔴 User socket disconnected:", socket.id);
    });

  } catch (err) {
    console.error("❌ Socket connection error:", err);
    socket.disconnect();
  }
});
/* ======================================================
   🧩 작업 채팅 전용 Socket Namespace
   namespace: /task
====================================================== */
const taskNsp = io.of("/task");

taskNsp.use((socket, next) => {
  sessionMiddleware(socket.request, {}, next);
});

taskNsp.on("connection", (socket) => {
  const user = socket.request.session?.user;
  if (!user) {
    socket.disconnect();
    return;
  }

  console.log("🧩 task socket connected:", socket.id);

  /* 🔹 작업 채팅 입장 */
  socket.on("task:join", ({ taskKey }) => {
    if (!taskKey) return;
    const roomName = `task:${taskKey}`;
    socket.join(roomName);
    console.log(`➡ task join: ${roomName}`);
  });

  /* 🔹 메시지 전송 */
  socket.on("task:send", async ({ taskKey, roomId, message }) => {
    if (!taskKey || !roomId || !message) return;

    const senderId = user.id;
    const now = nowStr();

    await db.query(
      `
      INSERT INTO chat_messages (room_id, sender_id, message, created_at)
      VALUES (?, ?, ?, ?)
      `,
      [roomId, senderId, message, now]
    );

    taskNsp.to(`task:${taskKey}`).emit("task:new", {
      roomId,
      senderId,
      message,
      created_at: now
    });
  });

  socket.on("disconnect", () => {
    console.log("🧩 task socket disconnected:", socket.id);
  });
});

/* ======================================================
   🔵 채팅방 생성
====================================================== */
app.post("/chat/start", async (req, res) => {
  try {
    const { targetId } = req.body;
    const me = req.session.user;

    if (!me) return res.json({ success: false, message: "로그인 필요" });
    if (!targetId) return res.json({ success: false, message: "상대 없음" });

    const myId = me.id;

    // 기존 방 찾기
    const [exist] = await db.query(
      `
      SELECT id FROM chat_rooms
      WHERE (user1_id=? AND user2_id=?)
         OR (user1_id=? AND user2_id=?)
      LIMIT 1
      `,
      [myId, targetId, targetId, myId]
    );

    if (exist.length > 0) {
      return res.json({ success: true, roomId: exist[0].id });
    }

    // 새 방 생성
    const [result] = await db.query(
      `INSERT INTO chat_rooms (user1_id, user2_id)
       VALUES (?, ?)`,
      [myId, targetId]
    );

    res.json({ success: true, roomId: result.insertId });

  } catch (err) {
    console.error("❌ chat/start error:", err);
    res.json({ success: false });
  }
});



/* ======================================================
   🔵 특정 roomId → 상대방 정보 조회
====================================================== */
app.get("/chat/room-info", async (req, res) => {
  try {
    const user = req.session.user;
    if (!user) return res.json({ success: false, message: "로그인 필요" });

    const myId = user.id;
    const roomId = req.query.roomId;

    if (!roomId) {
      return res.json({ success: false, message: "roomId 필요" });
    }

    // 채팅방 + 상대 정보 조회
    const [rows] = await db.query(
      `
      SELECT 
        r.id AS room_id,
        r.user1_id,
        r.user2_id,

        u.id AS other_id,
        COALESCE(ep.nickname, u.nickname) AS other_nickname,
        COALESCE(ep.avatar_url, u.avatar_url, '/assets/default_profile.png') AS other_avatar

      FROM chat_rooms r

      LEFT JOIN users u
        ON u.id = CASE
                    WHEN r.user1_id = ? THEN r.user2_id
                    ELSE r.user1_id
                  END

      LEFT JOIN expert_profiles ep
        ON ep.user_id = u.id

      WHERE r.id = ?
      `,
      [myId, roomId]
    );

    if (rows.length === 0) {
      return res.json({ success: false, message: "방 없음" });
    }

    const info = rows[0];

    return res.json({
      success: true,
      targetId: info.other_id,
      nickname: info.other_nickname,
      avatar: info.other_avatar,
    });

  } catch (err) {
    console.error("❌ /chat/room-info error:", err);
    return res.json({ success: false });
  }
});

/* ======================================================
   🔵 채팅방 메시지 불러오기
====================================================== */
app.get("/chat/messages", async (req, res) => {
  try {
    const { roomId } = req.query;

    if (!roomId) {
      return res.json({ success: false, message: "roomId 필요" });
    }

    const userId = req.session.user.id;

    const [rows] = await db.query(
      `SELECT 
         m.id AS message_id,
         m.sender_id,
         m.message,
         m.message_type,
         m.created_at,
         CASE 
           WHEN m.sender_id = ? THEN m.is_read 
           ELSE 0
         END AS is_read
       FROM chat_messages m
       WHERE m.room_id = ?
       ORDER BY m.created_at ASC`,
      [userId, roomId]
    );

    return res.json({ success: true, messages: rows });

  } catch (err) {
    console.error("❌ /chat/messages error:", err);
    return res.json({ success: false });
  }
});


/* ======================================================
   🔵 메시지 저장 + last_msg 업데이트 + 알림 브로드캐스트
====================================================== */
app.post("/chat/send-message", async (req, res) => {
  try {
    const { roomId, senderId, message, content, message_type } = req.body;

    const realMessage = message || content;
    if (!realMessage) {
      return res.json({ success: false, message: "EMPTY_MESSAGE" });
    }

    /* ======================================================
       1) 메시지 저장
    ====================================================== */
    const [result] = await db.query(
      `INSERT INTO chat_messages (room_id, sender_id, message, message_type)
       VALUES (?, ?, ?, ?)`,
      [roomId, senderId, realMessage, message_type || "text"]
    );

    const messageId = result.insertId;


    /* ======================================================
       2) last_msg 업데이트
    ====================================================== */
    const lastMsgPreview =
      message_type === "image"
        ? "📷 이미지"
        : realMessage.length > 80
        ? realMessage.substring(0, 80) + "..."
        : realMessage;

    const now = nowStr();

await db.query(
  `UPDATE chat_rooms 
   SET last_msg=?, updated_at=?
   WHERE id=?`,
  [lastMsgPreview, now, roomId]
);



    /* ======================================================
       3) 상대방(userId) 구하기
    ====================================================== */
    const [[room]] = await db.query(
      "SELECT user1_id, user2_id FROM chat_rooms WHERE id=?",
      [roomId]
    );

    const otherUserId =
      Number(room.user1_id) === Number(senderId)
        ? room.user2_id
        : room.user1_id;


    /* ======================================================
       4) unread 증가
    ====================================================== */
    await db.query(
      `INSERT INTO chat_unread (user_id, room_id, count)
       VALUES (?, ?, 1)
       ON DUPLICATE KEY UPDATE count = count + 1`,
      [otherUserId, roomId]
    );


    /* ======================================================
       5) 방에 있는 사람들에게 메시지 전송
    ====================================================== */
    io.to(String(roomId)).emit("chat:message", {
      id: messageId,
      message_id: messageId,
      roomId,
      senderId,
      content: realMessage,
      message_type,
      created_at: nowStr()

    });


    /* ======================================================
       6) 🔥 유저 개별 알림 — user:{id} 방으로 전송
    ====================================================== */
    io.to(`user:${otherUserId}`).emit("chat:notify", {
      roomId,
      senderId,
      targetId: otherUserId
    });

    console.log(`📢 chat:notify → user:${otherUserId} 에게 전송됨`);

    return res.json({ success: true, messageId });

  } catch (err) {
    console.error("❌ send-message error:", err);
    return res.json({ success: false });
  }
});


/* ======================================================
   🔵 2) 메시지 삭제 API
====================================================== */
app.delete("/chat/message/:id", async (req, res) => {
  try {
    const messageId = req.params.id;
    const userId = req.session.user?.id;

    if (!userId) {
      return res.json({ success: false, message: "로그인 필요" });
    }

    // 메시지 정보 조회
    const [[msg]] = await db.query(
      `SELECT sender_id, room_id FROM chat_messages WHERE id=?`,
      [messageId]
    );

    if (!msg) {
      return res.json({ success: false, message: "메시지 없음" });
    }

    // 본인 메시지만 삭제 가능
    if (msg.sender_id !== userId) {
      return res.json({ success: false, message: "권한 없음" });
    }

    // 삭제
    await db.query(`DELETE FROM chat_messages WHERE id=?`, [messageId]);

    // 실시간 삭제 이벤트
    io.to(String(msg.room_id)).emit("chat:delete", { messageId });

    return res.json({ success: true });

  } catch (err) {
    console.error("❌ delete message error:", err);
    return res.json({ success: false, message: "SERVER_ERROR" });
  }
});



/* ======================================================
   🔵 3) 메시지 읽음 처리 (카카오톡 방식)
====================================================== */
app.post("/chat/read", async (req, res) => {
  try {
    const { roomId } = req.body;
    const userId = req.session.user?.id;

    if (!roomId || !userId) {
      return res.json({ success: false, message: "roomId 또는 user 없음" });
    }

    // 상대방 메시지를 모두 읽음 처리
    await db.query(
      `UPDATE chat_messages
       SET is_read = 1
       WHERE room_id = ? AND sender_id != ?`,
      [roomId, userId]
    );

    // unread 카운트 초기화
    await db.query(
      `UPDATE chat_unread SET count = 0 WHERE user_id=? AND room_id=?`,
      [userId, roomId]
    );

    // 실시간 읽음 표시
    io.to(String(roomId)).emit("chat:read", {
      roomId,
      userId
    });

    return res.json({ success: true });

  } catch (err) {
    console.error("❌ chat/read error:", err);
    return res.json({ success: false });
  }
});



/* ======================================================
   🔵 방별 + 전체 unread 카운트 조회 API (완전 버전)
====================================================== */
app.get("/chat/unread-count", async (req, res) => {
  try {
    if (!req.session.user) {
      return res.json({ success: false, total: 0, rooms: {} });
    }

    const userId = req.session.user.id;

    // 1) 방별 unread 목록 가져오기
    const [rows] = await db.query(
      `SELECT room_id, count 
       FROM chat_unread 
       WHERE user_id=?`,
      [userId]
    );

    // 2) 방별 { roomId: count } 형태로 변환
    const rooms = {};
    rows.forEach(r => {
      rooms[r.room_id] = r.count;
    });

    // 3) 총합 계산
    const total = rows.reduce((sum, r) => sum + r.count, 0);

    return res.json({
      success: true,
      total,   // 전체 unread (index.html 용)
      rooms    // 방별 unread (chat.html 용)
    });

  } catch (err) {
    console.error("❌ unread-count error:", err);
    return res.json({ success: false, total: 0, rooms: {} });
  }
});

/* ============================================================
   🔵 브랜드 설계 조회 API (전문가가 유저 설계 보기)
   GET /brand-plan/view?user=23
============================================================ */
app.get("/brand-plan/view", async (req, res) => {
  const userId = req.query.user;

  if (!userId) {
    return res.json({ success: false, message: "userId 누락됨" });
  }

  try {
    const [rows] = await db.query(
      `SELECT 
         id,
         user_id,
         keywords,
         story,
         concept,
         tone_tags,
         target_customer,
         spread_tags,
         expand_plan,
         created_at,
         updated_at
       FROM brand_plans
       WHERE user_id = ?
       ORDER BY id DESC
       LIMIT 1`,
      [userId]
    );

    if (rows.length === 0) {
      return res.json({
        success: false,
        message: "브랜드 설계 데이터가 없습니다."
      });
    }

    res.json({
      success: true,
      plan: rows[0]
    });

  } catch (err) {
    console.error("❌ brand-plan/view 오류:", err);
    res.json({ success: false, message: "서버 오류 발생" });
  }
});

/* ======================================================
   🔵 브랜드 작업 히스토리 저장
====================================================== */
app.post("/brand-plan/history/add", servicesUpload.single("outputFile"), async (req, res) => {
  try {
    const { userId, plan_step, description, expertId, output_type, output_url } = req.body;

    let filePath = null;

    // 이미지 또는 영상 업로드 시
    if (req.file) {
      filePath = `/uploads/services/${req.session.user.id}/${req.file.filename}`;
    }

    await db.query(
      `INSERT INTO brand_history 
       (user_id, expert_id, plan_step, description, output_type, output_file, output_url)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        userId,
        expertId,
        plan_step,
        description,
        output_type,
        filePath,
        output_url || null
      ]
    );

    return res.json({ success: true });

  } catch (err) {
    console.error("❌ history add error:", err);
    return res.json({ success: false });
  }
});
/* ======================================================
   🔵 브랜드 작업 히스토리 조회
====================================================== */
app.get("/brand-plan/history", async (req, res) => {
  try {
    const userId = req.query.user;

    const [rows] = await db.query(
      `SELECT h.id, h.plan_step, h.description, h.output_type, 
              h.output_file, h.output_url, h.created_at,
              ep.nickname AS expert_nickname
       FROM brand_history h
       LEFT JOIN expert_profiles ep ON ep.user_id = h.expert_id
       WHERE h.user_id=?
       ORDER BY h.created_at DESC`,
      [userId]
    );

    res.json({ success: true, history: rows });

  } catch (err) {
    console.error("❌ history load error:", err);
    return res.json({ success: false });
  }
});

/* ======================================================
   🔵 비밀번호 재설정 - 인증번호 발송 (최종 안정 버전)
====================================================== */
app.post("/auth/send-reset-code", async (req, res) => {
  try {
    const { phone } = req.body;

    /* 1️⃣ 전화번호 검증 */
    if (!phone || !/^01[0-9]{8,9}$/.test(phone)) {
      return res.json({
        success: false,
        message: "올바른 전화번호를 입력해주세요."
      });
    }

    /* 2️⃣ 인증번호 생성 */
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const now = nowStr();

    /* 3️⃣ 기존 인증번호 정리 (같은 번호 기준) */
    await db.query(
      `DELETE FROM password_reset_codes WHERE phone = ?`,
      [phone]
    );

    /* 4️⃣ 새 인증번호 저장 */
    await db.query(
      `
      INSERT INTO password_reset_codes
      (phone, code, created_at)
      VALUES (?, ?, ?)
      `,
      [phone, code, now]
    );

    /* 5️⃣ SMS 발송 (🔥 실패해도 전체 로직은 성공 처리) */
    try {
      await sendSMS(
        phone,
        `[BlueOn] 비밀번호 재설정 인증번호: ${code}`
      );
    } catch (smsErr) {
      console.warn(
        "⚠️ SMS 전송 실패 (무시됨):",
        smsErr.response?.status || smsErr.message
      );
    }

    /* 6️⃣ 항상 성공 응답 */
    return res.json({
      success: true,
      message: "인증번호가 발송되었습니다."
    });

  } catch (err) {
    console.error("❌ 인증 코드 처리 오류:", err);

    // ❗ UX 보호: 서버 에러여도 실패로 보이지 않게 처리
    return res.json({
      success: true,
      message: "인증번호가 발송되었습니다."
    });
  }
});

/* ======================================================
   🔵 비밀번호 재설정 - 인증번호 확인
====================================================== */
app.post("/auth/verify-reset-code", async (req, res) => {
  const { email, code } = req.body;

  try {
    // 1️⃣ 이메일로 유저 조회 (id + phone)
    const [userRows] = await db.query(
      "SELECT id, phone FROM users WHERE email = ? LIMIT 1",
      [email]
    );

    if (userRows.length === 0) {
      return res.json({ success: false, message: "유저를 찾을 수 없습니다." });
    }

    const user = userRows[0];

    if (!user.phone) {
      return res.json({ success: false, message: "등록된 전화번호가 없습니다." });
    }

    // 2️⃣ phone 기준으로 가장 최근 인증번호 조회
    const [rows] = await db.query(
      `
      SELECT code
      FROM password_reset_codes
      WHERE phone = ?
      ORDER BY created_at DESC
      LIMIT 1
      `,
      [user.phone]
    );

    if (rows.length === 0) {
      return res.json({ success: false, message: "인증번호가 없습니다." });
    }

    // 3️⃣ 코드 비교
    if (String(rows[0].code) !== String(code)) {
      return res.json({ success: false, message: "인증번호가 일치하지 않습니다." });
    }

    // ✅ 인증 성공
    return res.json({
      success: true,
      userId: user.id
    });

  } catch (err) {
    console.error("❌ 인증 번호 확인 오류:", err);
    return res.json({ success: false, message: "서버 오류가 발생했습니다." });
  }
});


/* ======================================================
   🔵 비밀번호 재설정 - 최종 변경
====================================================== */
app.post("/auth/reset-password", async (req, res) => {
  const { email, newPassword } = req.body;

  try {
    if (!email || !newPassword) {
      return res.json({ success: false, message: "잘못된 요청입니다." });
    }

    // 1. 이메일로 userId 조회
    const [[user]] = await db.query(
      "SELECT id FROM users WHERE email = ?",
      [email]
    );

    if (!user) {
      return res.json({ success: false, message: "유저 없음" });
    }

    // 2. 비밀번호 암호화
    const encrypted = await bcrypt.hash(newPassword, 10);

    // 3. DB 업데이트
    await db.query(
      "UPDATE users SET password = ? WHERE id = ?",
      [encrypted, user.id]
    );

    return res.json({ success: true });

  } catch (err) {
    console.error("❌ 비밀번호 변경 오류:", err);
    return res.json({
      success: false,
      message: "서버 오류가 발생했습니다."
    });
  }
});






async function sendSMS(to, text) {
  const apiKey = process.env.SOLAPI_API_KEY;
  const apiSecret = process.env.SOLAPI_API_SECRET;

  const date = new Date().toISOString();
  const salt = crypto.randomBytes(16).toString("hex");
  const signature = crypto
    .createHmac("sha256", apiSecret)
    .update(date + salt)
    .digest("hex");

  const authorization = `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`;

  return axios.post(
    "https://api.solapi.com/messages/v4/send",
    {
      message: {
        to,
        from: process.env.SENDER_PHONE,
        text,
      },
    },
    {
      headers: {
        "Content-Type": "application/json",
        Authorization: authorization,
      },
    }
  );
}





/* ==========================================================
   🔵 특정 알림 삭제
========================================================== */
app.delete("/notice/delete", async (req, res) => {
  try {
    const id = req.query.id;

    if (!id) {
      return res.json({ success: false, message: "알림 ID 없음" });
    }

    // 로그인 체크
    if (!req.session.user) {
      return res.json({ success: false, message: "로그인 필요" });
    }

    const userId = req.session.user.id;

    // 해당 유저의 알림인지 검사 후 삭제
    const [del] = await db.query(
      `DELETE FROM notices WHERE id = ? AND user_id = ?`,
      [id, userId]
    );

    if (del.affectedRows > 0) {
      return res.json({ success: true });
    } else {
      return res.json({ success: false, message: "삭제할 알림이 없음" });
    }
  } catch (err) {
    console.error("❌ 알림 삭제 오류:", err);
    res.json({ success: false, message: "서버 오류" });
  }
});
// 🔵 전문가 서비스 삭제
app.delete("/expert/delete-service/:id", async (req, res) => {
  try {
    const serviceId = req.params.id;
    const userId = req.session.user?.id;

    if (!userId) {
      return res.status(401).json({ success: false, message: "로그인이 필요합니다." });
    }

    // ✔ service 작성자 확인 - user_id 컬럼 사용
    const [check] = await db.query(
      "SELECT id FROM services WHERE id = ? AND user_id = ?",
      [serviceId, userId]
    );

    if (check.length === 0) {
      return res.status(403).json({ success: false, message: "삭제 권한이 없습니다." });
    }

    // ✔ 삭제 실행
    await db.query("DELETE FROM services WHERE id = ?", [serviceId]);

    return res.json({ success: true, message: "삭제되었습니다." });

  } catch (err) {
    console.error("❌ 서비스 삭제 오류:", err);
    return res.status(500).json({ success: false, message: "서버 오류" });
  }
});

app.get("/expert/mypage", async (req, res) => {
  try {
    if (!req.session.user) {
      return res.json({ success: false });
    }

    const userId = req.session.user.id;

    /* ======================================================
       1) 전문가 프로필 정보 (expert_profiles 기준)
    ====================================================== */
    const [[profile]] = await db.query(
      `SELECT 
         nickname,
         intro,
         avatar_url
       FROM expert_profiles
       WHERE user_id = ?
       LIMIT 1`,
      [userId]
    );

    /* 프로필이 없을 수도 있으므로 기본값 처리 */
    const nickname  = profile?.nickname  || req.session.user.nickname || "전문가";
    const intro     = profile?.intro     || "아직 소개글이 없습니다!";
    let avatar_url  = profile?.avatar_url;

    // 업로드 이미지 path 안정화
    if (!avatar_url) {
      avatar_url = "/assets/default_profile.png";
    } else {
      if (!avatar_url.startsWith("/uploads/") && !avatar_url.startsWith("/assets/")) {
        avatar_url = "/uploads/" + avatar_url;
      }
    }

    /* ======================================================
       2) 서비스 개수
    ====================================================== */
    const [[svc]] = await db.query(
      `SELECT COUNT(*) AS count 
       FROM services 
       WHERE user_id=?`,
      [userId]
    );

    /* ======================================================
       3) 판매량 (buy_count 합계)
    ====================================================== */
    const [[sales]] = await db.query(
      `SELECT COALESCE(SUM(buy_count), 0) AS count
       FROM services
       WHERE user_id=?`,
      [userId]
    );

    /* ======================================================
       4) 채팅 문의 개수
    ====================================================== */
    const [[chat]] = await db.query(
      `SELECT COUNT(*) AS count
       FROM chat_rooms
       WHERE user1_id=? OR user2_id=?`,
      [userId, userId]
    );

    /* ======================================================
       최종 응답
    ====================================================== */
    return res.json({
      success: true,
      profile: {
        nickname,
        intro,
        avatar_url,
        serviceCount: svc.count,
        salesCount: sales.count,
        chatCount: chat.count
      }
    });

  } catch (err) {
    console.error("/expert/mypage error:", err);
    return res.json({ success: false });
  }
});



app.post("/orders/create", async (req, res) => {
  try {
    /* ---------------------------
       1️⃣ 로그인 체크
    --------------------------- */
    if (!req.session.user) {
      return res.status(401).json({
        success: false,
        message: "로그인이 필요합니다."
      });
    }

    const userId = req.session.user.id;
    const { serviceId } = req.body;

    /* ---------------------------
       2️⃣ serviceId 검증
    --------------------------- */
    if (!serviceId) {
      return res.status(400).json({
        success: false,
        message: "serviceId 누락"
      });
    }

    /* ---------------------------
       3️⃣ 중복 pending 주문 체크
    --------------------------- */
    const [[dup]] = await db.query(
      `
      SELECT id
      FROM orders
      WHERE user_id = ?
        AND service_id = ?
        AND status = 'pending'
      LIMIT 1
      `,
      [userId, serviceId]
    );

    if (dup) {
      return res.json({
        success: false,
        code: "DUPLICATE_PENDING",
        orderId: dup.id,
        message: "이미 입금 대기 중인 주문이 있습니다."
      });
    }

    /* ---------------------------
       4️⃣ 서비스 정보 조회
    --------------------------- */
    const [[svc]] = await db.query(
      `
      SELECT 
        user_id AS expert_id,
        price_basic,
        task_key,
        title
      FROM services
      WHERE id = ?
      `,
      [serviceId]
    );

    if (!svc || !svc.task_key) {
      return res.status(500).json({
        success: false,
        message: "서비스 task_key 없음"
      });
    }

    /* ---------------------------
       5️⃣ 주문 생성
    --------------------------- */
    const orderId = crypto.randomUUID();

    // 주문 단위 고유 task_key
    const taskKey = `${svc.task_key}_${orderId.slice(0, 8)}`;
    const createdAt = nowStr();

    await db.query(
      `
      INSERT INTO orders
      (
        id,
        user_id,
        expert_id,
        service_id,
        task_key,
        price,
        status,
        alarm_status,
        alarm_error,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, 'pending', 'none', '', ?)
      `,
      [
        orderId,
        userId,
        svc.expert_id,
        serviceId,
        taskKey,
        svc.price_basic,
        createdAt
      ]
    );

    /* ---------------------------
       6️⃣ 🔔 관리자 주문 알림
    --------------------------- */
    const adminId = Number(process.env.ADMIN_USER_ID);

    const adminMessage =
      `${req.session.user.nickname || "고객"}님이 ` +
      `'${svc.title}' 서비스를 구매했습니다.`;

    // DB 알림 저장
    await createNotice({
      targetUserId: adminId,
      message: adminMessage,
      type: "admin",
      taskKey,
      fromUser: userId
    });

    // 실시간 관리자 알림
    io.to("admin").emit("notice:new", {
      type: "admin",
      message: adminMessage,
      task_key: taskKey
    });

    /* ---------------------------
       7️⃣ 성공 응답 (🔥 반드시 필요)
    --------------------------- */
    return res.json({
      success: true,
      orderId,
      taskKey
    });

  } catch (err) {
    console.error("❌ orders/create error:", err);
    return res.status(500).json({ success: false });
  }
});

/* ======================================================
   🔵 주문 입금 확인 (관리자)
   - 무통장 입금 확인
   - work 채팅방 생성
   - orders.room_id 연결
====================================================== */
app.post("/orders/confirm-payment", async (req, res) => {
  try {
    if (!isAdmin(req)) {
      return res.status(403).json({
        success: false,
        message: "관리자 권한 필요"
      });
    }
    

    const { orderId } = req.body;
    if (!orderId) {
      return res.json({ success: false, message: "orderId 누락" });
    }

    /* ======================================================
       1️⃣ 주문 조회 (🔥 반드시 먼저)
    ====================================================== */
    const [[order]] = await db.query(
  `
  SELECT id, user_id, expert_id, room_id, status, task_key
  FROM orders
  WHERE id = ?
  `,
  [orderId]
);


    if (!order) {
      return res.json({ success: false, message: "주문 없음" });
    }

    /* ======================================================
       2️⃣ 이미 처리된 주문 방어
    ====================================================== */
    if (order.status === "paid") {
      return res.json({
        success: true,
        roomId: order.room_id,
        message: "이미 처리된 주문"
      });
    }

    /* ======================================================
       3️⃣ 구매자 + 서비스 정보
    ====================================================== */
    const [[buyer]] = await db.query(
      "SELECT nickname FROM users WHERE id = ?",
      [order.user_id]
    );

    const [[service]] = await db.query(
      `
      SELECT title
      FROM services
      WHERE id = (
        SELECT service_id FROM orders WHERE id = ?
      )
      `,
      [orderId]
    );

    /* ======================================================
       4️⃣ 🔔 전문가 구매 알림 생성 (1회)
    ====================================================== */
const noticeMessage =
  `${buyer?.nickname || "고객"}님이 ` +
  `'${service?.title || "서비스"}' 서비스를 구매하였습니다.`;


    /* ======================================================
       5️⃣ 채팅방 생성 (work)
    ====================================================== */
    let roomId = order.room_id;

    if (!roomId) {
      const today = new Date().toISOString().slice(0, 10);

      const [result] = await db.query(
        `
        INSERT INTO chat_rooms
        (order_id, user1_id, user2_id, room_type, created_at)
        VALUES (?, ?, ?, 'work', ?)
        `,
        [
          orderId,
          order.user_id,
          order.expert_id,
          today
        ]
      );

      roomId = result.insertId;

      await db.query(
        `UPDATE orders SET room_id = ? WHERE id = ?`,
        [roomId, orderId]
      );
    }

    /* ======================================================
       6️⃣ 주문 상태 paid 처리
    ====================================================== */
    await db.query(
      `UPDATE orders SET status = 'paid' WHERE id = ?`,
      [orderId]
    );

    return res.json({
      success: true,
      roomId
    });

  } catch (err) {
    console.error("❌ confirm-payment error:", err);
    return res.status(500).json({ success: false });
  }
});


/* ======================================================
   🔵 관리자 주문 목록 조회 (최종 안정 버전)
====================================================== */
app.get("/admin/orders", async (req, res) => {
  try {
    // 1️⃣ 관리자 권한 체크
    if (!isAdmin(req)) {
      return res.status(403).json({
        success: false,
        message: "관리자 권한이 필요합니다."
      });
    }

    // 2️⃣ 주문 목록 조회 (확장 안전)
    const [rows] = await db.query(`
      SELECT 
        o.id               AS order_id,
        o.task_key         AS task_key,
        o.price            AS price,
        o.status           AS status,
        o.created_at       AS created_at,

        -- 구매자 정보
        u.nickname         AS buyer_name,

        -- 전문가 정보
        ep.nickname        AS expert_name,

        -- 서비스 정보
        s.title            AS service_title

      FROM orders o

      JOIN users u
        ON u.id = o.user_id

      JOIN services s
        ON s.id = o.service_id

      JOIN expert_profiles ep
        ON ep.user_id = o.expert_id

      ORDER BY o.created_at DESC
    `);

    // 3️⃣ 응답
    return res.json({
      success: true,
      orders: rows
    });

  } catch (err) {
    console.error("❌ admin/orders error:", err);
    return res.status(500).json({
      success: false,
      message: "서버 오류"
    });
  }
});



/* ======================================================
   🔵 주문 상태 조회 (프론트)
====================================================== */
app.get("/orders/status", async (req, res) => {
  try {
    const { orderId } = req.query;
    if (!orderId) return res.json({ success: false });

    const [[row]] = await db.query(
      `SELECT status FROM orders WHERE id = ?`,
      [orderId]
    );

    if (!row) return res.json({ success: false });

    res.json({ success: true, status: row.status });

  } catch (err) {
    console.error("❌ orders/status error:", err);
    res.json({ success: false });
  }
});


/* ======================================================
   🔵 주문 상세 조회 (무통장 입금 페이지)
====================================================== */
app.get("/orders/:id", async (req, res) => {
  try {
    const orderId = req.params.id;

    const [rows] = await db.query(
      `SELECT * FROM orders WHERE id = ?`,
      [orderId]
    );

    if (!rows.length) {
      return res.json({ success: false });
    }

    res.json({ success: true, order: rows[0] });

  } catch (err) {
    console.error("❌ orders/:id error:", err);
    res.json({ success: false });
  }
});


/* ======================================================
   🔵 전문가 작업 목록 조회
   GET /expert/tasks
====================================================== */
app.get("/expert/tasks", async (req, res) => {
  try {
    // 1️⃣ 전문가 로그인 체크
    if (!req.session.user || !req.session.user.isExpert) {
      return res.status(401).json({ success: false });
    }

    const expertId = req.session.user.id;

    /* ======================================================
       2️⃣ 결제 완료됐지만 아직 작업(task) 생성 안 된 주문
       - 관리자 입금 확인 후
       - service_tasks에 아직 없는 상태
       → "작업 대기중"
    ====================================================== */
const [paidOrders] = await db.query(
  `
  SELECT
    o.task_key,
    o.created_at,
    s.id AS service_id,
    s.title AS service_title,
    s.main_images,
    u.nickname AS buyer_nickname
  FROM orders o
  JOIN services s ON s.id = o.service_id
  JOIN users u ON u.id = o.user_id
  WHERE o.expert_id = ?
    AND o.status = 'paid'
    AND o.task_key NOT IN (
      SELECT task_key FROM service_tasks
    )
  ORDER BY o.created_at DESC
  `,
  [expertId]
);

    /* ======================================================
       3️⃣ 이미 생성된 작업(service_tasks)
       → 진행중 / 완료
    ====================================================== */
    const [tasks] = await db.query(
      `
      SELECT
        t.task_key,
        t.status,
        t.phase,
        t.created_at,
        t.thumbnail,
        s.title AS service_title,
        u.nickname AS buyer_nickname
      FROM service_tasks t
      JOIN services s ON s.id = t.service_id
      JOIN users u ON u.id = t.buyer_id
      WHERE t.expert_id = ?
      ORDER BY t.created_at DESC
      `,
      [expertId]
    );

    /* ======================================================
   4️⃣ 프론트에서 바로 쓰기 좋은 형태로 통합
   - task_key 기준 중복 제거
   - service_tasks가 있으면 무조건 우선
====================================================== */
const map = new Map();

/* 🔹 작업 대기 (결제 완료 / 아직 service_tasks 없음) */
paidOrders.forEach(o => {
  const imgs = parseImagesSafe(o.main_images);

  map.set(o.task_key, {
    task_key: o.task_key,
    service_title: o.service_title,
    buyer_nickname: o.buyer_nickname || "의뢰인",
    thumbnail: imgs[0] || "/assets/default_service.png",
    status: "pending",        // 🔥 시작 전
    phase: "ready",
    created_at: o.created_at
  });
});

/* 🔹 진행중 / 완료 작업 (service_tasks 기준 → 무조건 덮어씀) */
tasks.forEach(t => {
  map.set(t.task_key, {
    task_key: t.task_key,
    service_title: t.service_title,
    buyer_nickname: t.buyer_nickname || "의뢰인",
    thumbnail: t.thumbnail || "/assets/default_service.png",
    status: t.status,         // progress | done
    phase: t.phase,
    created_at: t.created_at
  });
});

/* 🔹 최종 결과 배열 */
const result = Array.from(map.values());

return res.json({
  success: true,
  tasks: result
});


  } catch (err) {
    console.error("❌ /expert/tasks error:", err);
    return res.status(500).json({ success: false });
  }
});

/* ======================================================
   🔵 유저 작업 현황 조회 + 수정 요청 생성 (통합)
   - GET  /my/tasks
   - POST /tasks/revision-request
====================================================== */

/* =========================
   1️⃣ 유저 작업 현황 조회
========================= */
app.get("/my/tasks", async (req, res) => {
  try {
    if (!req.session.user) {
      return res.status(401).json({ success: false });
    }

    const userId = req.session.user.id;

    const [rows] = await db.query(
      `
      SELECT
        o.task_key,
        o.created_at,

        s.title AS service_title,
        s.main_images,

        COALESCE(ep.nickname, '전문가') AS expert_nickname,

        -- 🔥 핵심: task 없으면 pending, 있으면 그대로
        COALESCE(t.status, 'pending') AS task_status,

        COALESCE(
          t.thumbnail,
          JSON_UNQUOTE(JSON_EXTRACT(s.main_images, '$[0]')),
          '/assets/default_service.png'
        ) AS thumbnail

      FROM orders o
      JOIN services s
        ON s.id = o.service_id
      JOIN expert_profiles ep
        ON ep.user_id = o.expert_id
      LEFT JOIN service_tasks t
        ON t.task_key = o.task_key

      WHERE o.user_id = ?
        AND o.status = 'paid'

      ORDER BY o.created_at DESC
      `,
      [userId]
    );

    const tasks = rows.map(r => ({
      task_key: r.task_key,
      service_title: r.service_title,
      expert_nickname: r.expert_nickname,
      status: r.task_status,          // 🔴 프론트는 이 값만 믿는다
      thumbnail: r.thumbnail,
      created_at: r.created_at
    }));

    return res.json({
      success: true,
      tasks
    });

  } catch (err) {
    console.error("❌ /my/tasks error:", err);
    return res.status(500).json({ success: false });
  }
});


/* =========================
   2️⃣ 유저 → 전문가 수정 요청
========================= */
app.post("/tasks/revision-request", async (req, res) => {
  try {
    if (!req.session.user) {
      return res.json({ success: false });
    }

    const { taskKey, message } = req.body;
    const userId = req.session.user.id;

    if (!taskKey || !message) {
      return res.json({ success: false });
    }

    /* 🔥 expert_id 조회 */
    const [[order]] = await db.query(
      `
      SELECT expert_id
      FROM orders
      WHERE task_key = ?
      LIMIT 1
      `,
      [taskKey]
    );

    if (!order) {
      return res.json({ success: false });
    }

    /* 🔥 ID 수동 생성 */
    const [[row]] = await db.query(
      `
      SELECT IFNULL(MAX(id), 0) + 1 AS newId
      FROM task_revision_requests
      `
    );

    const now = nowStr();

    /* 🔥 수정 요청 저장 */
    await db.query(
      `
      INSERT INTO task_revision_requests
      (id, task_key, user_id, expert_id, message, status, created_at, is_read)
      VALUES (?, ?, ?, ?, ?, 'open', ?, 0)
      `,
      [
        row.newId,
        taskKey,
        userId,
        order.expert_id,
        message,
        now
      ]
    );
    /* ======================================================
       🔔 4️⃣ 🔥 전문가 알림 생성 (INSERT 바로 아래)
    ====================================================== */
    const noticeMessage =
      `${req.session.user.nickname || "고객"}님이 수정 요청을 보냈습니다.`;

    // DB 알림 저장
    await createNotice({
      targetUserId: task.expert_id,
      message: noticeMessage,
      type: "trade",
      taskKey: taskKey,
      fromUser: userId
    });

    // 실시간 알림 (헤더/배지 즉시 반영)
    io.to(`user:${task.expert_id}`).emit("notice:new", {
      type: "trade",
      message: noticeMessage,
      task_key: taskKey
    });

    return res.json({ success: true });

  } catch (err) {
    console.error("❌ revision request error:", err);
    return res.json({ success: false });
  }
});


/* ======================================================
   🔵 전문가 미읽음 수정 요청 개수 조회
   GET /expert/tasks/revision-count?taskKey=xxx
====================================================== */
app.get("/expert/tasks/revision-count", async (req, res) => {
  try {
    if (!req.session.user || !req.session.user.isExpert) {
      return res.json({ success: false });
    }

    const { taskKey } = req.query;
    const expertId = req.session.user.id;

    if (!taskKey) {
      return res.json({ success: false, count: 0 });
    }

    const [[row]] = await db.query(
      `
      SELECT COUNT(*) AS cnt
      FROM task_revision_requests
      WHERE expert_id = ?
        AND task_key = ?
        AND is_read = 0
      `,
      [expertId, taskKey]
    );

    return res.json({
      success: true,
      count: row.cnt
    });

  } catch (err) {
    console.error("❌ revision count error:", err);
    return res.json({ success: false, count: 0 });
  }
});

/* ======================================================
   🔵 전문가 작업 상세 조회
   GET /expert/tasks/detail?taskKey=xxx
====================================================== */
app.get("/expert/tasks/detail", async (req, res) => {
  try {
    // 1️⃣ 로그인 + 전문가 체크
    if (!req.session.user || !req.session.user.isExpert) {
      return res.status(401).json({ success: false });
    }

    const expertId = req.session.user.id;
    const { taskKey } = req.query;

    if (!taskKey) {
      return res.json({ success: false, message: "taskKey 누락" });
    }

    /* ======================================================
       2️⃣ 작업 상세 조회
       - orders + service_tasks + services + users
    ====================================================== */
    const [[row]] = await db.query(
      `
SELECT
  o.task_key,
  o.created_at,

  COALESCE(t.status, 'pending') AS status,
  COALESCE(t.phase, 'ready') AS phase,

  -- 🔥 핵심: task 썸네일이 없으면 서비스 썸네일 사용
  COALESCE(
    t.thumbnail,
    JSON_UNQUOTE(JSON_EXTRACT(s.main_images, '$[0]'))
  ) AS thumbnail,

  s.title AS service_title,

  u.id AS buyer_id,
  u.nickname AS buyer_nickname,

  o.room_id
FROM orders o
JOIN services s ON s.id = o.service_id
JOIN users u ON u.id = o.user_id
LEFT JOIN service_tasks t ON t.task_key = o.task_key
WHERE o.task_key = ?
  AND o.expert_id = ?
LIMIT 1

      `,
      [taskKey, expertId]
    );

    if (!row) {
      return res.json({ success: false, message: "작업 없음" });
    }

    /* ======================================================
       3️⃣ 응답
    ====================================================== */
    return res.json({
      success: true,
      task: {
        task_key: row.task_key,
        status: row.status,
        phase: row.phase,
        created_at: row.created_at,
        service_title: row.service_title,
        thumbnail: row.thumbnail || "/assets/default_service.png",
        buyer: {
          id: row.buyer_id,
          nickname: row.buyer_nickname || "의뢰인"
        },
        room_id: row.room_id
      }
    });

  } catch (err) {
    console.error("❌ /expert/tasks/detail error:", err);
    return res.status(500).json({ success: false });
  }
});

/* ======================================================
   ✅ 수정 요청 읽음 처리 (전문가)
   POST /expert/tasks/revision-read
   body: { taskKey }
====================================================== */
app.post("/expert/tasks/revision-read", async (req, res) => {
  try {
    if (!req.session.user || !req.session.user.isExpert) {
      return res.status(401).json({ success: false });
    }

    const expertId = req.session.user.id;
    const { taskKey } = req.body;

    if (!taskKey) {
      return res.json({ success: false, message: "taskKey 누락" });
    }

    // ✅ 해당 taskKey의 미읽음 요청 -> 전부 읽음 처리
    await db.query(
      `
      UPDATE task_revision_requests
      SET is_read = 1
      WHERE expert_id = ?
        AND task_key = ?
        AND is_read = 0
      `,
      [expertId, taskKey]
    );

    return res.json({ success: true });

  } catch (err) {
    console.error("❌ revision-read error:", err);
    return res.status(500).json({ success: false });
  }
});
/* ======================================================
   ✅ 수정 요청 단건 읽음 처리 (전문가)
   POST /expert/tasks/revision-read/:id
====================================================== */
app.post("/expert/tasks/revision-read/:id", async (req, res) => {
  try {
    if (!req.session.user || !req.session.user.isExpert) {
      return res.status(401).json({ success: false });
    }

    const expertId = req.session.user.id;
    const id = req.params.id;

    if (!id) return res.json({ success: false, message: "id 누락" });

    await db.query(
      `
      UPDATE task_revision_requests
      SET is_read = 1
      WHERE id = ?
        AND expert_id = ?
      `,
      [id, expertId]
    );

    return res.json({ success: true });

  } catch (err) {
    console.error("❌ revision-read single error:", err);
    return res.status(500).json({ success: false });
  }
});

/* ======================================================
   🔔 유저 → 관리자 입금 완료 알림
   - status 변경 ❌
   - 관리자 알림 DB 저장
   - 관리자 socket 실시간 알림
   - 🔥 동일 주문 중복 알림 완전 차단 (orders.alarm_status 기준)
====================================================== */
app.post("/orders/notify-deposit", async (req, res) => {
  try {
    /* ---------------------------
       1️⃣ 로그인 체크
    --------------------------- */
    if (!req.session.user) {
      return res.json({ success: false });
    }

    const { orderId } = req.body;
    if (!orderId) {
      return res.json({ success: false });
    }

    /* ---------------------------
       2️⃣ 주문 + 유저 정보 조회
    --------------------------- */
    const [[order]] = await db.query(
  `
  SELECT
    o.id,
    o.user_id        AS buyer_id,
    o.expert_id,
    o.service_id,
    o.room_id,
    o.status,
    o.task_key,
    s.main_images    -- ✅ 이걸로 교체
  FROM orders o
  JOIN services s ON s.id = o.service_id
  WHERE o.id = ?
  `,
  [orderId]
);


    // 🔥 구매자 정보
const [[buyer]] = await db.query(
  "SELECT nickname FROM users WHERE id = ?",
  [order.user_id]
);

// 🔥 서비스 정보
const [[service]] = await db.query(
  "SELECT title FROM services WHERE id = (SELECT service_id FROM orders WHERE id = ?)",
  [orderId]
);


    if (!order) {
      return res.json({ success: false });
    }

    /* ---------------------------
       3️⃣ 🔕 이미 알림 보낸 주문 → 즉시 종료
    --------------------------- */
    if (order.alarm_status === "sent") {
      return res.json({
        success: true,
        alreadySent: true
      });
    }

    /* ---------------------------
       4️⃣ 관리자 알림 메시지
    --------------------------- */
    const smsText =
`[BlueOn 입금 알림]
주문번호: ${order.id}
유저: ${order.nickname || "알 수 없음"}
금액: ${Number(order.price).toLocaleString()}원

관리자 페이지에서 입금 확인하세요.`;

    /* ---------------------------
       5️⃣ 📱 관리자 SMS 발송 (실패해도 OK)
    --------------------------- */
    try {
      await sendSMS(
        process.env.ADMIN_PHONE,
        smsText
      );
    } catch (smsErr) {
      console.warn("⚠️ 관리자 SMS 발송 실패:", smsErr.message);
    }

    /* ---------------------------
       6️⃣ 관리자 알림 DB 저장 (실패해도 OK)
    --------------------------- */
    try {
  const now = nowStr();

  await db.query(
    `
    INSERT INTO notices (user_id, message, type, created_at)
    VALUES (?, ?, 'admin', ?)
    `,
    [
      process.env.ADMIN_USER_ID,
      `입금 요청: ${order.nickname || "알 수 없음"} (주문 ${order.id})`,
      now
    ]
  );
} catch (dbErr) {
  console.warn("⚠️ 관리자 알림 DB 저장 실패:", dbErr.message);
}


    /* ---------------------------
       7️⃣ 관리자 socket 실시간 알림 (실패해도 OK)
    --------------------------- */
    try {
      io.to("admin").emit("admin:deposit-notify", {
        orderId: order.id,
        message: smsText
      });
    } catch (socketErr) {
      console.warn("⚠️ 관리자 소켓 알림 실패:", socketErr.message);
    }

    /* ---------------------------
       8️⃣ 알림 성공 처리 기록 (🔥 핵심)
    --------------------------- */
    await db.query(
      `UPDATE orders SET alarm_status='sent', alarm_error='' WHERE id=?`,
      [order.id]
    );

    /* ---------------------------
       9️⃣ 항상 성공 응답 (alert 완전 차단)
    --------------------------- */
    return res.json({ success: true });

  } catch (err) {
    console.error("❌ notify-deposit error:", err);

    // ❗ 어떤 에러가 나도 UX는 실패로 만들지 않는다
    return res.json({ success: true });
  }
});

// 관리자 입금 확인 처리 (🔥 단일 책임 최종본)
app.post("/admin/order/confirm", async (req, res) => {
  try {
    // 0️⃣ 관리자 권한 체크
    if (!isAdmin(req)) {
      return res.status(403).json({
        success: false,
        message: "관리자 권한 필요"
      });
    }

    const { orderId } = req.body;
    if (!orderId) {
      return res.json({ success: false, message: "orderId 누락" });
    }

    /* ======================================================
   1️⃣ 주문 조회 (기본 정보)
====================================================== */
const [[order]] = await db.query(
  `
  SELECT
    o.id,
    o.user_id    AS buyer_id,
    o.expert_id,
    o.service_id,
    o.room_id,
    o.status,
    o.task_key,
    s.main_images
  FROM orders o
  JOIN services s ON s.id = o.service_id
  WHERE o.id = ?
  `,
  [orderId]
);

    /* ======================================================
       2️⃣ 이미 처리된 주문 방어 (🔥 중복 클릭 차단)
    ====================================================== */
    if (order.status === "paid") {
      return res.json({
        success: true,
        roomId: order.room_id,
        message: "이미 처리된 주문"
      });
    }

    /* ======================================================
       3️⃣ 채팅방 생성 (work) - 1회만
    ====================================================== */
    let roomId = order.room_id;

    if (!roomId) {
      const today = new Date().toISOString().slice(0, 10);

      const [result] = await db.query(
        `
        INSERT INTO chat_rooms
        (order_id, user1_id, user2_id, room_type, created_at)
        VALUES (?, ?, ?, 'work', ?)
        `,
        [
          orderId,
          order.buyer_id,
          order.expert_id,
          today
        ]
      );

      roomId = result.insertId;

      await db.query(
        `UPDATE orders SET room_id = ? WHERE id = ?`,
        [roomId, orderId]
      );
    }

    /* ======================================================
       4️⃣ 주문 상태 paid 처리 (🔥 여기서만)
    ====================================================== */
    await db.query(
      `UPDATE orders SET status = 'paid' WHERE id = ?`,
      [orderId]
    );

/* ======================================================
   5️⃣ service_tasks 생성 (중복 방지 + 썸네일 안정 처리)
====================================================== */
/* ======================================================
   5️⃣ service_tasks 생성 (중복 방지)
====================================================== */
const [[exist]] = await db.query(
  "SELECT id FROM service_tasks WHERE task_key = ? LIMIT 1",
  [order.task_key]
);

if (!exist) {
  // 🔥 services.main_images → 썸네일 안전 파싱
  const images = parseImagesSafe(order.main_images);
  const thumbnail = images[0] || "/assets/default_service.png";

  const now = nowStr(); // ✅ 서버 시간 통일

await db.query(
  `
  INSERT INTO service_tasks
  (
    task_key,
    service_id,
    buyer_id,
    expert_id,
    status,
    phase,
    thumbnail,
    created_at
  )
  VALUES (?, ?, ?, ?, 'pending', 'ready', ?, ?)
  `,
  [
    order.task_key,
    order.service_id,
    order.buyer_id,
    order.expert_id,
    thumbnail,
    now
  ]
);

}



    /* ======================================================
       6️⃣ 전문가 알림 (DB + Socket)
    ====================================================== */
    const noticeMessage = "입금이 확인되었습니다. 작업을 시작해 주세요.";

    try {
      await createNotice({
        targetUserId: order.expert_id,
        message: noticeMessage,
        type: "trade",
        taskKey: order.task_key,
        fromUser: Number(process.env.ADMIN_USER_ID) || null
      });

      io.to(`user:${order.expert_id}`).emit("notice:new", {
        type: "trade",
        message: noticeMessage,
        task_key: order.task_key
      });
    } catch (noticeErr) {
      console.warn("⚠️ 전문가 알림 실패:", noticeErr.message);
    }

    /* ======================================================
       7️⃣ 성공 응답
    ====================================================== */
    return res.json({
      success: true,
      roomId
    });

  } catch (err) {
    console.error("❌ admin/order/confirm error:", err);
    return res.status(500).json({ success: false });
  }
});

/* ======================================================
   🔔 알림 단건 읽음 처리
   POST /notice/read/:id
====================================================== */
app.post("/notice/read/:id", async (req, res) => {
  try {
    if (!req.session.user) {
      return res.status(401).json({ success: false });
    }

    const noticeId = req.params.id;
    const userId = req.session.user.id;

    await db.query(
      "UPDATE notices SET is_read = 1 WHERE id = ? AND user_id = ?",
      [noticeId, userId]
    );

    return res.json({ success: true });

  } catch (err) {
    console.error("❌ notice read error:", err);
    return res.status(500).json({ success: false });
  }
});
/* ======================================================
   🔵 전문가 작업 시작
   - INSERT ❌
   - pending → progress 로만 변경
====================================================== */
app.post("/expert/tasks/start", async (req, res) => {
  try {
    /* --------------------------------------------------
       1️⃣ 전문가 로그인 체크
    -------------------------------------------------- */
    if (!req.session.user || !req.session.user.isExpert) {
      return res.status(401).json({ success: false });
    }

    const expertId = req.session.user.id;
    const { taskKey } = req.body;

    if (!taskKey) {
      return res.json({
        success: false,
        message: "taskKey 누락"
      });
    }

    /* --------------------------------------------------
       2️⃣ 주문 존재 + 소유권 + 결제 완료 확인
       (orders 기준 → 단일 진실 소스)
    -------------------------------------------------- */
    const [[order]] = await db.query(
      `
      SELECT o.task_key
      FROM orders o
      WHERE o.task_key = ?
        AND o.expert_id = ?
        AND o.status = 'paid'
      LIMIT 1
      `,
      [taskKey, expertId]
    );

    if (!order) {
      return res.json({
        success: false,
        message: "작업을 시작할 수 없습니다."
      });
    }

    /* --------------------------------------------------
       3️⃣ service_tasks 상태 변경
       - pending → progress 만 허용
       - INSERT ❌
    -------------------------------------------------- */
    const [result] = await db.query(
      `
      UPDATE service_tasks
      SET
        status = 'progress',
        phase = 'working'
      WHERE task_key = ?
        AND expert_id = ?
        AND status = 'pending'
      `,
      [taskKey, expertId]
    );

    /* --------------------------------------------------
       4️⃣ 방어: 이미 시작되었거나 task 없음
    -------------------------------------------------- */
    if (result.affectedRows === 0) {
      return res.json({
        success: false,
        message: "이미 시작된 작업이거나 작업이 존재하지 않습니다."
      });
    }

    /* --------------------------------------------------
       5️⃣ 성공
    -------------------------------------------------- */
    return res.json({ success: true });

  } catch (err) {
    console.error("❌ /expert/tasks/start error:", err);
    return res.status(500).json({ success: false });
  }
});

/* ======================================================
   🔵 채팅방 목록 (프로필 이미지 완전 보정)
====================================================== */
app.get("/chat/rooms", async (req, res) => {
  try {
    const user = req.session.user;
    if (!user) return res.json({ success: false });

    const myId = user.id;

    const [rows] = await db.query(
      `
      SELECT 
        r.id AS room_id,
        r.user1_id,
        r.user2_id,
        r.last_msg,
        r.updated_at,

        u.id AS other_id,

        COALESCE(ep.nickname, u.nickname, u.name, '사용자') AS other_nickname,

        CASE
          WHEN ep.avatar_url IS NOT NULL AND ep.avatar_url <> '' THEN ep.avatar_url
          WHEN u.avatar_url IS NOT NULL AND u.avatar_url <> '' THEN u.avatar_url
          ELSE '/assets/default_profile.png'
        END AS other_avatar

      FROM chat_rooms r

      LEFT JOIN users u
        ON u.id = CASE 
                    WHEN r.user1_id = ? THEN r.user2_id
                    ELSE r.user1_id
                  END

      LEFT JOIN expert_profiles ep
        ON ep.user_id = u.id

      WHERE r.user1_id = ? OR r.user2_id = ?
      ORDER BY r.updated_at DESC
      `,
      [myId, myId, myId]
    );

    return res.json({ success: true, rooms: rows });

  } catch (err) {
    console.error("❌ /chat/rooms error:", err);
    return res.json({ success: false });
  }
});

/* ======================================================
   🔵 전문가 작업 요약
   GET /expert/tasks/summary
====================================================== */
app.get("/expert/tasks/summary", async (req, res) => {
  try {
    if (!req.session.user || !req.session.user.isExpert) {
      return res.status(401).json({ success: false });
    }

    const expertId = req.session.user.id;

    const [[row]] = await db.query(`
      SELECT
        SUM(CASE WHEN t.status = 'progress' THEN 1 ELSE 0 END) AS progress,
        SUM(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END) AS done
      FROM service_tasks t
      WHERE t.expert_id = ?
    `, [expertId]);

    return res.json({
      success: true,
      summary: {
        progress: row.progress || 0,
        done: row.done || 0
      }
    });

  } catch (err) {
    console.error("❌ tasks summary error:", err);
    return res.status(500).json({ success: false });
  }
});

/* ------------------ 테스트용 ------------------ */
app.get("/test/expert", async (req, res) => {
  const [rows] = await db.query("SELECT * FROM expert_profiles");
  res.json(rows);
});


/* ------------------ 서버 실행 ------------------ */
httpServer.listen(PORT, () => {
  console.log(`🔥 서버 실행됨: PORT = ${PORT}`);
});
