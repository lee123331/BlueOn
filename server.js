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

app.use(
  session({
    key: "blueon.sid",
    secret: process.env.SESSION_SECRET || "blueon_secret",
    resave: false,
    saveUninitialized: false,
    store: sessionStore,
    cookie: {
      httpOnly: true,
      secure: false,
      sameSite: "lax",
      maxAge: 1000 * 60 * 60 * 24, // 1일
    },
  })
);

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
   🔵 Socket.io 서버 생성
====================================================== */
const httpServer = http.createServer(app);

const io = new SocketIOServer(httpServer, {
  cors: {
    origin: ["http://localhost:3000", "http://localhost:5173"],
    credentials: true,
  },
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
    const newId = Math.floor(Math.random() * 1000000000);

    // 5) 저장 (created_at + updated_at 모두 포함)
    await db.execute(
      `
      INSERT INTO users 
      (id, provider, provider_id, email, password, phone, created_at, updated_at)
      VALUES (?, 'local', ?, ?, ?, ?, NOW(), NOW())
      `,
      [newId, email, email, hashedPw, phone]
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



      /* ==========================================================
         🔥 4) INSERT — id 추가함
      ========================================================== */
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
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW(), ?, ?, ?, ?, ?, ?)
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

    /* =============================================================
       INSERT (신규 전문가 등록)
    ============================================================= */
    if (exist.length === 0) {
      await db.query(
        `INSERT INTO expert_profiles
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
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
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
        ]
      );
    }

    /* =============================================================
       UPDATE (기존 전문가 정보 수정)
    ============================================================= */
    else {
      await db.query(
        `UPDATE expert_profiles SET
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
          updated_at=NOW()
        WHERE user_id=?`,
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
          userId,
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
      `SELECT 
         id,
         title,
         price_basic,
         main_images,
         sub_category
       FROM services
       WHERE user_id = ?
       ORDER BY id DESC`,
      [userId]
    );

    return res.json({
      success: true,
      services: rows,
    });
  } catch (err) {
    console.error("my-services 오류:", err);
    return res.json({
      success: false,
      message: "서비스 목록을 불러올 수 없습니다.",
    });
  }
});
// 🔵 로그인한 유저 + 전문가 여부 반환
app.get("/auth/me", async (req, res) => {
  try {
    // 로그인 안 함
    if (!req.session.user) {
      return res.json({ success: false, user: null });
    }

    const userId = req.session.user.id;

    // 🔍 users + expert_profiles 조인
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

    // 유저 없음
    if (!row) {
      return res.json({ success: false, user: null });
    }

    // ================================
    // 세션 동기화 (프론트 메뉴가 즉시 반영되도록)
    // ================================
    req.session.user.nickname   = row.nickname;
    req.session.user.intro      = row.intro;
    req.session.user.avatar_url = row.avatar_url;
    req.session.user.isExpert   = row.is_expert === 1;

    // ================================
    // 응답 (프론트는 이 값만 사용함)
    // ================================
    return res.json({
      success: true,
      user: {
        id        : row.id,
        email     : row.email,
        nickname  : row.nickname || null,
        intro     : row.intro || null,
        avatar_url: row.avatar_url || null,

        // 🔥 반드시 넣어야 하는 필드
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

    const { expertId, serviceTitle } = req.body;
    const requesterId = req.session.user.id;   // 요청자 ID

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

    const userName = req.session.user.nickname || req.session.user.name || "유저";

    const message = `${userName}님이 '${serviceTitle}' 서비스에서 포트폴리오를 요청했습니다.`;

    await db.query(
  "INSERT INTO notices (user_id, message, type) VALUES (?, ?, 'trade')",
  [expertId, message]
);


    return res.json({ success: true });
  } catch (err) {
    console.error("portfolio request notice error:", err);
    res.json({ success: false });
  }
});

/* =======================================================
   🔔 전문가 알림 목록 (거래/시스템 분리)
   GET /notice/list?type=trade
   GET /notice/list?type=system
======================================================= */
app.get("/notice/list", async (req, res) => {
  try {
    if (!req.session.user) {
      return res.json({ success: false, notices: [] });
    }

    const userId = req.session.user.id;
    const type = req.query.type || "trade"; // 기본: 거래 알림

    const [rows] = await db.query(
      "SELECT id, message, created_at, is_read FROM notices WHERE user_id=? AND type=? ORDER BY id DESC",
      [userId, type]
    );

    return res.json({
      success: true,
      notices: rows
    });

  } catch (err) {
    console.error("notice list error:", err);
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
   🔵 Socket.io (정상 구조)
====================================================== */
io.on("connection", (socket) => {
  console.log("🟢 Socket connected:", socket.id);

  // 📌 유저별 개인 room 등록 → 개인 알림 가능
  const userId = socket.handshake.auth?.userId;
  if (userId) {
    socket.join(`user:${userId}`);
    console.log(`➡ user:${userId} 방에 입장`);
  }

  /* ------------------ 방 입장 ------------------ */
  socket.on("chat:join", (roomId) => {
    if (!roomId) return;
    socket.join(String(roomId));
    console.log(`📌 chat:join → room ${roomId}`);
  });

  /* ------------------ typing 표시 ------------------ */
  socket.on("chat:typing", ({ roomId, userId, isTyping }) => {
    socket.to(String(roomId)).emit("chat:typing", {
      roomId,
      userId,
      isTyping,
    });
  });

  /* ------------------ 읽음 표시 ------------------ */
socket.on("chat:read", ({ roomId, userId }) => {
  socket.to(String(roomId)).emit("chat:read", { roomId, userId });
});


  /* ------------------ 메시지 삭제 ------------------ */
  socket.on("chat:delete", ({ roomId, messageId }) => {
    socket.to(String(roomId)).emit("chat:delete", { messageId });
  });

  /* ------------------ 연결 종료 ------------------ */
  socket.on("disconnect", () => {
    console.log("🔴 Socket disconnected:", socket.id);
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

    await db.query(
      `UPDATE chat_rooms 
       SET last_msg=?, updated_at=NOW()
       WHERE id=?`,
      [lastMsgPreview, roomId]
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
      created_at: new Date()
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
   🔵 비밀번호 재설정 - 인증번호 발송
====================================================== */
app.post("/auth/send-reset-code", async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.json({ success: false, message: "이메일이 필요합니다." });
    }

    // 1) 이메일로 유저 검색
    const [rows] = await db.query("SELECT id, phone FROM users WHERE email=?", [email]);

    if (rows.length === 0) {
      return res.json({
        success: false,
        message: "해당 이메일로 가입한 계정이 없습니다."
      });
    }

    const user = rows[0];

    if (!user.phone) {
      return res.json({
        success: false,
        message: "이 계정에 등록된 전화번호가 없습니다."
      });
    }

    // 2) 인증번호 생성
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expireAt = Date.now() + 3 * 60 * 1000; // 3분 유효

    // 3) 저장
    await db.query(
      `INSERT INTO reset_codes (user_id, code, expire_at)
       VALUES (?, ?, ?)`,
      [user.id, code, expireAt]
    );

    // 4) SMS 발송
    await sendSMS(user.phone, `[BlueOn] 비밀번호 재설정 인증번호: ${code}`);

    return res.json({
      success: true,
      message: "인증번호가 발송되었습니다."
    });

  } catch (err) {
    console.error("❌ 인증 코드 발송 오류:", err);
    return res.json({ success: false, message: "서버 오류" });
  }
});

/* ======================================================
   🔵 비밀번호 재설정 - 인증번호 확인
====================================================== */
app.post("/auth/verify-reset-code", async (req, res) => {
  const { email, code } = req.body;

  try {
    // 1. 이메일로 유저 ID 조회
    const [userRows] = await db.query(
      "SELECT id FROM users WHERE email = ?",
      [email]
    );

    if (userRows.length === 0) {
      return res.json({ success: false, message: "유저를 찾을 수 없습니다." });
    }

    const userId = userRows[0].id;

    // 2. 가장 최근 인증번호 가져오기
    const [rows] = await db.query(
      "SELECT * FROM reset_codes WHERE user_id = ? ORDER BY id DESC LIMIT 1",
      [userId]
    );

    if (rows.length === 0) {
      return res.json({ success: false, message: "인증번호가 없습니다." });
    }

    const record = rows[0];

    // 3. 코드 확인
    if (record.code != code) {
      return res.json({ success: false, message: "인증번호가 일치하지 않습니다." });
    }

    // 4. 만료 확인
    if (new Date(record.expire_at).getTime() < Date.now()) {
      return res.json({ success: false, message: "인증번호가 만료되었습니다." });
    }

    // 인증 성공
    res.json({ success: true, userId });

  } catch (err) {
    console.error("❌ 인증 번호 확인 오류:", err);
    res.json({ success: false, message: "서버 오류가 발생했습니다." });
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


/* ======================================================
   🔵 채팅방 목록 (프로필 이미지 포함)
====================================================== */
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
app.get("/test/expert", async (req, res) => {
  const [rows] = await db.query("SELECT * FROM expert_profiles");
  res.json(rows);
});
httpServer.listen(PORT, () => {
  console.log(`🔥 서버 실행됨: PORT = ${PORT}`);
});

