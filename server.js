console.log("### BOOT server.js ###");

console.log("### RUNNING SERVER (WeatherAPI build) ###");
console.log("### BOOT: server.js entered ###");
process.on("exit", (code) => console.log("### EXIT:", code));
setTimeout(() => console.log("### still alive after 2s ###"), 2000);

const cheerio = require('cheerio');
const multer = require('multer');
const Tesseract = require('tesseract.js');
const fs = require('fs');
const express = require("express");
const axios = require("axios");
const cors = require("cors");
const path = require("path");
const session = require("express-session");
const FileStore = require("session-file-store")(session);
const bcrypt = require("bcrypt");
const sqlite3 = require("sqlite3").verbose();

// 환경변수 로딩 (key.env 파일에서)
try {
  const envContent = fs.readFileSync(path.join(__dirname, 'key.env'), 'utf8');
  envContent.split('\n').forEach(line => {
    const [key, value] = line.split('=');
    if (key && value && !key.startsWith('#')) {
      process.env[key.trim()] = value.trim();
    }
  });
  console.log('✅ key.env 파일 로드 완료');
} catch (error) {
  console.log('⚠️ key.env 파일 로드 실패, 기본값 사용');
}

const app = express();
const PORT = process.env.PORT || 3000;

// ─────────────────────────────────────────────
// Parsers & CORS
// ─────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─────────────────────────────────────────────
// In-memory Metrics (since process start)
// ─────────────────────────────────────────────
const metrics = {
  since: new Date().toISOString(),
  extract: { total: 0, success: 0, fail: 0, latencyMsSum: 0 },
  searchPlace: { total: 0, hit: 0, miss: 0, latencyMsSum: 0 },
  findBest: { total: 0, ok: 0, ambiguous: 0, noCandidates: 0, fail: 0, latencyMsSum: 0 }
};

app.get("/metrics", (_req, res) => {
  const avg = (sum, count) => (count ? sum / count : 0);
  const extract = metrics.extract;
  const searchPlace = metrics.searchPlace;
  const findBest = metrics.findBest;
  res.json({
    since: metrics.since,
    extract: {
      total: extract.total,
      success: extract.success,
      fail: extract.fail,
      successRate: extract.total ? extract.success / extract.total : 0,
      avgLatencyMs: avg(extract.latencyMsSum, extract.total)
    },
    searchPlace: {
      total: searchPlace.total,
      hit: searchPlace.hit,
      miss: searchPlace.miss,
      hitRate: searchPlace.total ? searchPlace.hit / searchPlace.total : 0,
      avgLatencyMs: avg(searchPlace.latencyMsSum, searchPlace.total)
    },
    findBest: {
      total: findBest.total,
      ok: findBest.ok,
      ambiguous: findBest.ambiguous,
      noCandidates: findBest.noCandidates,
      fail: findBest.fail,
      top1Rate: findBest.total ? findBest.ok / findBest.total : 0,
      ambiguousRate: findBest.total ? findBest.ambiguous / findBest.total : 0,
      noCandidateRate: findBest.total ? findBest.noCandidates / findBest.total : 0,
      avgLatencyMs: avg(findBest.latencyMsSum, findBest.total)
    }
  });
});

// ─────────────────────────────────────────────
// Sessions (FileStore)
// ─────────────────────────────────────────────
const sessionDir = path.join(__dirname, "sessions");
if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir, { recursive: true });
app.use(session({
  store: new FileStore({ path: sessionDir, retries: 1 }),
  secret: process.env.SESSION_SECRET || "dev-secret-change-me",
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: "lax", secure: false, maxAge: 1000*60*60*24*7 }
}));

// ─────────────────────────────────────────────
// SQLite (users)
// ─────────────────────────────────────────────
const db = new sqlite3.Database(path.join(__dirname, "auth.db"));
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    nickname TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`);
  
  // 기존 사용자를 위한 닉네임 마이그레이션 (안전하게 처리)
  db.run(`ALTER TABLE users ADD COLUMN nickname TEXT`, (err) => {
    if (err && err.code !== 'SQLITE_ERROR') {
      console.log('⚠️ nickname 컬럼 추가 중 오류:', err.message);
    }
  });
  // nickname 컬럼이 비어있는 기존 사용자만 업데이트 (새 사용자 보호)
  db.run(`UPDATE users SET nickname = '사용자' || id WHERE nickname IS NULL OR nickname = '' OR nickname = 'undefined' OR nickname = 'null'`);
  
  // ─────────────────────────────────────────────
  // DB: places 테이블 (users 바로 아래에 두세요)
  // ─────────────────────────────────────────────
  db.run(`CREATE TABLE IF NOT EXISTS places(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT,
    address TEXT,
    lat REAL,
    lng REAL,
    region TEXT,
    category TEXT,
    created_at TEXT NOT NULL,
    UNIQUE(user_id, name, address)
  )`);
});
const findUserByEmail = (email) => new Promise((resolve, reject)=>{
  db.get(`SELECT * FROM users WHERE email=?`, [email], (err,row)=>{
    if (err) reject(err); else resolve(row);
  });
});
const createUser = async (email, nickname, password) => {
  const hash = await bcrypt.hash(password, 10);
  const createdAt = new Date().toISOString();
  return new Promise((resolve, reject)=>{
    db.run(`INSERT INTO users(email,nickname,password_hash,created_at) VALUES(?,?,?,?)`,
      [email, nickname, hash, createdAt],
      function(err){ if (err) reject(err); else resolve({ id: this.lastID, email, nickname }); }
    );
  });
};

// ─────────────────────────────────────────────
// Auth routes
// ─────────────────────────────────────────────
app.get("/auth/me", (req,res)=>{
  if (req.session?.user) return res.json({ ok:true, user: req.session.user });
  return res.status(401).json({ ok:false });
});
app.post("/auth/register", async (req,res)=>{
  try{
    const { email, nickname, password } = req.body || {};
    if (!email || !nickname || !password) return res.status(400).json({ ok:false, error:"email/nickname/password required" });
    const exists = await findUserByEmail(email);
    if (exists) return res.status(409).json({ ok:false, error:"already_exists" });
    const user = await createUser(email, nickname, password);
    req.session.user = { id: user.id, email: user.email, nickname: user.nickname };
    return res.json({ ok:true });
  }catch(e){ return res.status(500).json({ ok:false, error:"register_failed" }); }
});
app.post("/auth/login", async (req,res)=>{
  try{
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ ok:false, error:"email/password required" });
    const row = await findUserByEmail(email);
    if (!row) return res.status(401).json({ ok:false, error:"invalid" });
    const ok = await bcrypt.compare(password, row.password_hash);
    if (!ok) return res.status(401).json({ ok:false, error:"invalid" });
    req.session.user = { id: row.id, email: row.email, nickname: row.nickname };
    return res.json({ ok:true });
  }catch(e){ return res.status(500).json({ ok:false, error:"login_failed" }); }
});
app.post("/auth/logout", (req,res)=>{
  req.session.destroy(()=> res.json({ ok:true }));
});

// ─────────────────────────────────────────────
// My Places API (사용자별)
// ─────────────────────────────────────────────
app.get("/api/my-places", requireLogin, (req, res) => {
  const uid = req.session.user.id;
  db.all(
    `SELECT id, name, address, lat, lng, region, category, created_at as createdAt
     FROM places WHERE user_id=? ORDER BY datetime(created_at) DESC, id DESC`,
    [uid],
    (err, rows) => {
      if (err) return res.status(500).json({ ok:false, error:"db_read_failed" });
      res.json(rows || []);
    }
  );
});

app.post("/api/my-places", requireLogin, (req, res) => {
  const uid = req.session.user.id;
  const p = req.body || {};
  const name = p.name || "";
  const address = p.address || "";
  const lat = p.lat ?? null;
  const lng = p.lng ?? null;
  const region = p.region || "";
  const category = p.category || "";
  const createdAt = p.createdAt || new Date().toISOString();

  db.get(
    `SELECT id FROM places WHERE user_id=? AND name=? AND address=?`,
    [uid, name, address],
    (err, row) => {
      if (err) return res.status(500).json({ ok:false, error:"db_update_failed" });
      if (row) {
        db.run(
          `UPDATE places SET lat=?, lng=?, region=?, category=?, created_at=? WHERE id=?`,
          [lat, lng, region, category, createdAt, row.id],
          function (e) {
            if (e) return res.status(500).json({ ok:false, error:"db_update_failed" });
            return res.json({ ok:true, id: row.id, mode:"update" });
          }
        );
      } else {
        db.run(
          `INSERT INTO places(user_id,name,address,lat,lng,region,category,created_at) VALUES(?,?,?,?,?,?,?,?)`,
          [uid, name, address, lat, lng, region, category, createdAt],
          function (e) {
            if (e) return res.status(500).json({ ok:false, error:"db_insert_failed" });
            return res.json({ ok:true, id: this.lastID, mode:"insert" });
          }
        );
      }
    }
  );
});

app.delete("/api/my-places/:id", requireLogin, (req, res) => {
  const uid = req.session.user.id;
  const id = Number(req.params.id);
  db.run(`DELETE FROM places WHERE id=? AND user_id=?`, [id, uid], function (e) {
    if (e) return res.status(500).json({ ok:false, error:"db_delete_failed" });
    return res.json({ ok:true, deleted: this.changes });
  });
});

// ─────────────────────────────────────────────
// Login gate
// ─────────────────────────────────────────────
function requireLogin(req, res, next){
  if (req.session?.user) return next();
  const wantsJSON = (req.headers.accept||"").includes("application/json") || req.path.startsWith("/api");
  if (wantsJSON) return res.status(401).json({ ok:false, error:"unauthenticated" });
  const nextUrl = encodeURIComponent(req.originalUrl || "/app");
  return res.redirect(`/login?next=${nextUrl}`);
}

// 1) 루트는 항상 로그인 화면을 먼저
app.get("/", (req, res) => {
  res.sendFile("login.html", { root: __dirname });
});

// 2) 공개 라우트 (항상 문자열 + root 옵션)
app.get("/login", (req, res) => res.sendFile("login.html", { root: __dirname }));
app.get("/register", (req, res) => res.sendFile("register.html", { root: __dirname }));

// 3) 앱 진입: 보호 라우트 (간단하고 안전하게)
app.get(["/app", "/index-map.html"], requireLogin, (req, res) => {
  res.sendFile("index-map.html", { root: __dirname });
});



// 정적 서빙: index 자동 제공 막기 (게이트 우회 방지)
app.use(express.static(__dirname, { index: false }));

// (선택) 앱 페이지는 캐시 금지: 로그아웃 후 뒤로 가기 차단
app.use("/app", requireLogin, (req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

// Health check (public)
app.get("/health", (_req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

// Multer 설정
const upload = multer({
    storage: multer.diskStorage({
        destination: function (req, file, cb) {
            const uploadDir = 'uploads';
            if (!fs.existsSync(uploadDir)) {
                fs.mkdirSync(uploadDir);
            }
            cb(null, uploadDir);
        },
        filename: function (req, file, cb) {
            cb(null, Date.now() + path.extname(file.originalname));
        }
    })
});

// uploads 디렉토리 생성
if (!fs.existsSync('uploads')) {
    fs.mkdirSync('uploads');
}

app.post('/extract', async (req, res) => {
    const _t0 = Date.now();
    metrics.extract.total += 1;
    try {
        const { url } = req.body;
        
        // Instagram URL 감지
        const isInstagram = url.includes('instagram.com');
        
        // URL별 맞춤 헤더 설정
        const headers = isInstagram ? {
            'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_7_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1.2 Mobile/15E148 Safari/604.1',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'ko-KR,ko;q=0.8,en-US;q=0.5,en;q=0.3',
            'Accept-Encoding': 'gzip, deflate',
            'Referer': 'https://www.instagram.com/',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1'
        } : {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        };

        console.log(`${isInstagram ? 'Instagram' : '일반'} URL 처리:`, url);
        
        const response = await axios.get(url, { 
            headers,
            timeout: 10000,
            maxRedirects: 5
        });
        const $ = cheerio.load(response.data);
        
        let extractedText = '';
        let hashtags = '';
        
        if (isInstagram) {
            // Instagram 전용 추출 로직
            console.log('Instagram 전용 파싱 시작...');
            
            // 1. 메타 태그들 확인
            const ogDescription = $('meta[property="og:description"]').attr('content');
            const metaDescription = $('meta[name="description"]').attr('content');
            const ogTitle = $('meta[property="og:title"]').attr('content');
            
            console.log('OG Description:', ogDescription);
            console.log('Meta Description:', metaDescription);
            console.log('OG Title:', ogTitle);
            
            // 2. JSON-LD 스크립트 태그에서 추출 시도
            let jsonLdData = null;
            $('script[type="application/ld+json"]').each((i, elem) => {
                try {
                    const jsonText = $(elem).html();
                    const data = JSON.parse(jsonText);
                    if (data && (data.caption || data.description || data.name)) {
                        jsonLdData = data;
                        console.log('JSON-LD 데이터 발견:', data);
                    }
                } catch (e) {
                    // JSON 파싱 실패는 무시
                }
            });
            
            // 3. window._sharedData에서 추출 시도
            const scriptTags = $('script:not([src])').toArray();
            for (let script of scriptTags) {
                const scriptContent = $(script).html();
                if (scriptContent && scriptContent.includes('window._sharedData')) {
                    try {
                        // _sharedData에서 데이터 추출
                        const match = scriptContent.match(/window\._sharedData\s*=\s*({.*?});/);
                        if (match) {
                            const sharedData = JSON.parse(match[1]);
                            console.log('_sharedData 발견, 분석 중...');
                            // 여기서 포스트 데이터 추출 로직 추가 가능
                        }
                    } catch (e) {
                        console.log('_sharedData 파싱 실패');
                    }
                }
            }
            
            // 4. 우선순위에 따라 텍스트 선택
            if (jsonLdData && jsonLdData.caption) {
                extractedText = jsonLdData.caption;
            } else if (ogDescription && ogDescription.length > 10) {
                extractedText = ogDescription;
            } else if (metaDescription && metaDescription.length > 10) {
                extractedText = metaDescription;
            } else if (ogTitle && ogTitle.length > 5) {
                extractedText = ogTitle;
            }
            
            console.log('Instagram에서 추출된 텍스트:', extractedText);
            
        } else {
            // 일반 URL 처리 (기존 로직)
            const description = $('meta[property="og:description"]').attr('content');
            
            if (description) {
                extractedText = description;
            } else {
                const article = $('article');
                if (article.length > 0) {
                    extractedText = article.text().trim();
                }
            }
        }
        
        if (extractedText) {
            // 해시태그와 본문 분리
            const hashtagMatches = extractedText.match(/#[\w가-힣]+/g) || [];
            hashtags = hashtagMatches.join(' ');
            const mainText = extractedText.replace(/#[\w가-힣]+/g, '').trim();
            
            metrics.extract.success += 1;
            metrics.extract.latencyMsSum += (Date.now() - _t0);
            return res.json({
                success: true,
                data: {
                    text: mainText,
                    hashtags: hashtags,
                    fullText: extractedText
                }
            });
        } else {
            metrics.extract.fail += 1;
            metrics.extract.latencyMsSum += (Date.now() - _t0);
            return res.json({
                success: false,
                error: '포스트 내용을 찾을 수 없습니다.'
            });
        }
    } catch (error) {
        console.error('Error:', error.message);
        metrics.extract.fail += 1;
        metrics.extract.latencyMsSum += (Date.now() - _t0);
        return res.json({
            success: false,
            error: '포스트 내용을 가져오는데 실패했습니다. 링크를 확인해주세요.'
        });
    }
});

// 이미지 처리 엔드포인트
app.post('/extract-image', upload.single('image'), async (req, res) => {
    try {
        if (!req.file) {
            return res.json({
                success: false,
                error: '이미지 파일이 없습니다.'
            });
        }

        console.log('Processing image:', req.file.path);

        const result = await Tesseract.recognize(
            req.file.path,
            'kor+eng',
            {
                logger: m => console.log(m),
                tessedit_char_whitelist: '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ가-힣ㄱ-ㅎㅏ-ㅣ!@#$%^&*()_+-=[]{}|;:,.<>?/~` '
            }
        );

        // 임시 파일 삭제
        fs.unlinkSync(req.file.path);

        // 추출된 텍스트에서 해시태그 분리
        const text = result.data.text;
        const hashtags = text.match(/#[\w가-힣]+/g) || [];
        const mainText = text.replace(/#[\w가-힣]+/g, '').trim();

        res.json({
            success: true,
            data: {
                text: mainText,
                hashtags: hashtags.join(' ')
            }
        });
    } catch (error) {
        console.error('Error processing image:', error);
        res.json({
            success: false,
            error: '이미지 처리 중 오류가 발생했습니다.'
        });
    }
});

// 네이버 지역(장소) 검색 프록시 엔드포인트
app.get('/search-place', async (req, res) => {
    const _t0 = Date.now();
    metrics.searchPlace.total += 1;
    const query = req.query.query;
    const clientId = 'dv09yJvf1T8W4_pyPYjs';         // 여기에 본인 Client ID 입력
    const clientSecret = 'k4ncKS6rkV'; // 여기에 본인 Client Secret 입력

    if (!query) {
        return res.status(400).json({ error: '검색어가 필요합니다.' });
    }

    try {
        console.log('네이버 API 요청:', query);
        
        const response = await axios.get('https://openapi.naver.com/v1/search/local.json', {
            params: { query, display: 1 },
            headers: {
                'X-Naver-Client-Id': clientId,
                'X-Naver-Client-Secret': clientSecret
            }
        });
        
        console.log('네이버 API 응답:', response.status, response.data);
        const hit = Array.isArray(response.data?.items) && response.data.items.length > 0;
        if (hit) metrics.searchPlace.hit += 1; else metrics.searchPlace.miss += 1;
        metrics.searchPlace.latencyMsSum += (Date.now() - _t0);
        return res.json(response.data);
    } catch (error) {
        console.error('네이버 API 에러:', error.response?.status, error.response?.data);
        metrics.searchPlace.miss += 1;
        metrics.searchPlace.latencyMsSum += (Date.now() - _t0);
        
        if (error.response?.status === 401) {
            res.status(401).json({ error: '네이버 API 인증 실패 - Client ID/Secret을 확인해주세요.' });
        } else if (error.response?.status === 403) {
            res.status(403).json({ error: '네이버 API 권한 없음 - API 사용 권한을 확인해주세요.' });
        } else if (error.response?.status === 429) {
            res.status(429).json({ error: '네이버 API 요청 제한 - 잠시 후 다시 시도해주세요.' });
        } else {
            return res.status(500).json({ error: '장소 검색 실패', details: error.message });
        }
    }
});

// 날씨 정보 프록시 엔드포인트
app.get("/weather", async (req, res) => {
  try {
    // 🔑 WeatherAPI 키 (하드코딩 또는 환경변수에서 불러오기)
    const API_KEY = process.env.WEATHERAPI_KEY || "fb1f1bca635a446c9dc192911251008"; 
    if (!API_KEY) {
      return res.status(500).json({ message: "Missing WeatherAPI key" });
    }

    const { city, lat, lon } = req.query;
    const q = lat && lon ? `${lat},${lon}` : (city || "Seoul");

    const url = "https://api.weatherapi.com/v1/current.json";
    console.log("PROVIDER=WEATHERAPI CALL:", url, "q=", q);

    const { data } = await axios.get(url, {
      params: { key: API_KEY, q, lang: "ko" },
    });

    // WeatherAPI 스키마 그대로 반환
    return res.json(data);
  } catch (err) {
    const status = err?.response?.status || 500;
    const payload = err?.response?.data || { message: err.message || "Unknown error" };
    console.error("WEATHERAPI ERROR:", status, payload);

    // 폴백(WeatherAPI 스키마와 동일)
    return res.json({
      location: { name: "서울" },
      current: {
        temp_c: 23,
        humidity: 45,
        wind_kph: 7.2,
        condition: { text: "맑음" },
      },
    });
  }
});

// 프로세스 전역 에러 로깅
process.on("uncaughtException", (e) => {
  console.error("UNCAUGHT:", e);
});
process.on("unhandledRejection", (e) => {
  console.error("UNHANDLED:", e);
});

// ======================= 상호 자동 랭킹 라우트 =========================
const jaro = require('jaro-winkler');

const stringSimilarity = require('string-similarity');

// 한글 초성 추출
function cho(str='') {
  const CHO = [ 'ㄱ','ㄲ','ㄴ','ㄷ','ㄸ','ㄹ','ㅁ','ㅂ','ㅃ','ㅅ','ㅆ','ㅇ','ㅈ','ㅉ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ' ];
  let out = '';
  for (const ch of (str || '').normalize('NFC')) {
    const code = ch.charCodeAt(0) - 0xAC00;
    if (code >= 0 && code <= 11171) out += CHO[Math.floor(code / 588)];
    else if (/[A-Za-z]/.test(ch)) out += ch.toLowerCase();
  }
  return out;
}
function tokenSet(s='') {
  return new Set(
    (s || '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/).filter(Boolean)
  );
}
function jaccard(a='', b='') {
  const A = tokenSet(a), B = tokenSet(b);
  const inter = new Set([...A].filter(x => B.has(x))).size;
  const union = new Set([...A, ...B]).size || 1;
  return inter / union;
}
function extractAreaHints(text='') {
  const hints = new Set();
  const re = /(서울|경기|인천|부산|대전|대구|광주|울산|세종)|([가-힣]{1,6}(구|군))|([A-Za-z가-힣]{1,10}역)/g;
  let m;
  while ((m = re.exec(text)) !== null) hints.add(m[0]);
  return [...hints];
}
function extractPhones(text='') {
  return [...new Set((text.match(/0\d{1,2}[-.\s]?\d{3,4}[-.\s]?\d{4}/g) || []))];
}
function extractStrongNames(lines=[], tags=[]) {
  const cand = new Set();
  const push = (s) => {
    s = (s||'').trim().replace(/["""']/g,'').replace(/\s{2,}/g,' ');
    if (s.length >= 2) {
      cand.add(s);
      cand.add(s.replace(/(본점|역점|지점|점)$/, ''));
    }
  };
  (tags || []).forEach(t => push(t.replace(/^#/, '')));
  (lines || []).forEach(line => {
    if (/(카페|맛집|베이커리|라멘|스시|펍|와인|브런치|디저트)/.test(line)) push(line);
    const head = line.split(/[(:\-|]/)[0];
    if (head && head.length >= 2) push(head);
  });
  return [...new Set([...cand].map(x => x.trim()).filter(x => x && x.length <= 30))];
}
function scoreCandidate(c, ctx) {
  let score = 0, reasons = [];
  const nameScores = (ctx.strongNames || []).map(n => {
    const base = Math.max(
      jaro(n, c.name || ''),
      stringSimilarity.compareTwoStrings(n, c.name || ''),
      jaccard(n, c.name || '')
    );
    const choScore = (cho(n) && cho(c.name)) ? stringSimilarity.compareTwoStrings(cho(n), cho(c.name)) : 0;
    return Math.max(base, choScore * 0.9);
  });
  const nameScore = Math.max(0, ...nameScores, 0);
  score += nameScore * 50;
  if (nameScore > 0.85) reasons.push(`상호 유사도↑(${nameScore.toFixed(2)})`);

  const catHit = (ctx.textKeywords || []).some(k => (c.category || '').includes(k));
  if (catHit) { score += 10; reasons.push('카테고리 키워드 일치'); }

  const addrHit = (ctx.areaHints || []).some(h => (c.address || '').includes(h));
  if (addrHit) { score += 12; reasons.push('구/동/역 힌트 일치'); }

  const phoneHit = (ctx.phoneHints || []).some(p => c.phone && c.phone.replace(/\D/g,'').includes(p.replace(/\D/g,'')));
  if (phoneHit) { score += 8; reasons.push('전화번호 일치'); }

  const overlap = (c.menuKeywords || []).filter(m => (ctx.menuHints || []).includes(m)).length;
  if (overlap) { score += Math.min(12, 4 * overlap); reasons.push('메뉴 키워드 겹침'); }

  if (ctx.sourceBoost?.[c.name]) { score += ctx.sourceBoost[c.name]; reasons.push('링크 시그널'); }

  return { score, reasons };
}
function rankCandidates(candidates=[], ctx={}) {
  const ranked = candidates.map(c => ({ ...c, ...scoreCandidate(c, ctx) }))
                           .sort((a,b)=> b.score - a.score);
  if (ranked.length >= 2) {
    const [a,b] = ranked;
    if (a.score >= 45 && (a.score - b.score) / Math.max(b.score,1) >= 0.12) {
      return { pick: a, ranked };
    }
  } else if (ranked.length === 1 && ranked[0].score >= 45) {
    return { pick: ranked[0], ranked };
  }
  return { pick: null, ranked };
}
async function naverLocalSearch(query, axios, clientId, clientSecret) {
  const url = 'https://openapi.naver.com/v1/search/local.json';
  const resp = await axios.get(url, {
    params: { query, display: 5, start: 1, sort: 'random' },
    headers: {
      'X-Naver-Client-Id': clientId,
      'X-Naver-Client-Secret': clientSecret
    },
    timeout: 7000
  });
  return (resp.data?.items || []).map(it => ({
    name: (it.title || '').replace(/<[^>]+>/g,''),
    category: it.category || '',
    address: it.address || it.roadAddress || '',
    phone: it.telephone || '',
    link: it.link || '',
    mapx: it.mapx, mapy: it.mapy
  }));
}
function dedupe(cands) {
  const seen = new Set();
  const out = [];
  for (const c of cands) {
    const key = `${(c.name||'').trim()}|${(c.address||'').trim()}`;
    if (!seen.has(key)) { seen.add(key); out.push(c); }
  }
  return out;
}

/**
 * POST /api/findBestPlace
 * body: { ocrText?, linkTitle?, linkDesc?, instaCaption?, hashtags?, textKeywords?, menuHints?, sourceBoostMap? }
 */
app.post('/api/findBestPlace', async (req, res) => {
  const _t0 = Date.now();
  metrics.findBest.total += 1;
  try {
    const {
      ocrText = '',
      linkTitle = '',
      linkDesc = '',
      instaCaption = '',
      hashtags = '',
      textKeywords,
      menuHints,
      sourceBoostMap
    } = req.body || {};

    const allText = [ocrText, linkTitle, linkDesc, instaCaption, hashtags].filter(Boolean).join('\n');
    const ocrLines = (ocrText || '').split(/\n/).map(s => s.trim()).filter(Boolean);

    const ctx = {
      strongNames: extractStrongNames(ocrLines, (hashtags || '').split(/\s+/)),
      textKeywords: (textKeywords && textKeywords.length) ? textKeywords
                    : ['카페','베이커리','브런치','라멘','스시','와인바','디저트','펍','바','버거','피자','파스타','한식','중식','양식'],
      areaHints: extractAreaHints(allText),
      phoneHints: extractPhones(allText),
      menuHints: menuHints || ['말차','크루아상','티라미수','라떼','규동','와인','스콘','케이크'],
      sourceBoost: sourceBoostMap || {}
    };

    // 네이버 키: 기존 /search-place에 있는 하드코딩 값 재사용
    const clientId = 'dv09yJvf1T8W4_pyPYjs';
    const clientSecret = 'k4ncKS6rkV';
    if (!clientId || !clientSecret) {
      return res.status(400).json({ error: '네이버 API 키가 없습니다.' });
    }

    // 검색 쿼리 구성
    let baseQueries = ctx.strongNames.slice(0,5);
    if (baseQueries.length === 0) {
      const words = (allText.replace(/[^\p{L}\p{N}\s]/gu,' ').split(/\s+/).filter(w=>w.length>=2)).slice(0,20);
      baseQueries = [words.join(' ')];
    }
    const areaTerms = ctx.areaHints.slice(0,2);
    const queries = [];
    for (const q of baseQueries.slice(0,5)) {
      if (areaTerms.length) areaTerms.forEach(h => queries.push(`${q} ${h}`));
      else queries.push(q);
    }
    if (queries.length === 0 && allText) queries.push(allText.slice(0,30));

    // 후보 수집
    let allCandidates = [];
    for (const q of queries.slice(0,8)) {
      try {
        const items = await naverLocalSearch(q, axios, clientId, clientSecret);
        allCandidates.push(...items);
      } catch (e) { /* 개별 실패 무시 */ }
    }
    allCandidates = dedupe(allCandidates);
    if (allCandidates.length === 0) {
      metrics.findBest.noCandidates += 1;
      metrics.findBest.latencyMsSum += (Date.now() - _t0);
      return res.json({ status: 'no_candidates', message: '검색 후보가 없습니다.', debug: { queries, ctx_preview: { strongNames: ctx.strongNames, areaHints: ctx.areaHints } } });
    }

    // 랭킹
    const { pick, ranked } = rankCandidates(allCandidates, ctx);
    if (pick) {
      metrics.findBest.ok += 1;
      metrics.findBest.latencyMsSum += (Date.now() - _t0);
      return res.json({
        status: 'ok',
        place: {
          name: pick.name, address: pick.address, category: pick.category,
          phone: pick.phone, link: pick.link, mapx: pick.mapx, mapy: pick.mapy
        },
        reasons: pick.reasons,
        debug: { queries, ctx_preview: { strongNames: ctx.strongNames, areaHints: ctx.areaHints, phoneHints: ctx.phoneHints } }
      });
    } else {
      metrics.findBest.ambiguous += 1;
      metrics.findBest.latencyMsSum += (Date.now() - _t0);
      return res.json({
        status: 'ambiguous',
        top3: ranked.slice(0,3).map(r => ({
          name: r.name, address: r.address, category: r.category,
          score: Math.round(r.score), reasons: r.reasons, link: r.link
        })),
        debug: { queries, ctx_preview: { strongNames: ctx.strongNames, areaHints: ctx.areaHints, phoneHints: ctx.phoneHints } }
      });
    }
  } catch (err) {
    const code = err?.response?.status || 500;
    const data = err?.response?.data;
    metrics.findBest.fail += 1;
    metrics.findBest.latencyMsSum += (Date.now() - _t0);
    return res.status(code).json({
      error: 'findBestPlace_error',
      message: err.message,
      naver: data || null
    });
  }
});
// ===================== /상호 자동 랭킹 라우트 끝 =======================

// 4) 와일드카드 대신 미들웨어로 처리 (모든 API 라우트 이후에 실행)
app.use((req, res, next) => {
  // 이미 처리된 라우트는 건너뛰기
  if (res.headersSent) return next();
  
  // 로그인/회원가입/인증/정적 에셋은 제외
  if (req.path.startsWith('/login') || 
      req.path.startsWith('/register') || 
      req.path.startsWith('/auth') ||
      req.path.startsWith('/health') ||
      req.path.startsWith('/uploads') ||
      req.path.includes('.')) {
    return next();
  }
  
  // 나머지는 모두 로그인 필요
  requireLogin(req, res, () => {
    res.sendFile("index-map.html", { root: __dirname });
  });
});

app.listen(PORT, () => console.log(`### Server is running on http://localhost:${PORT}`));

console.log("### BOOT: server.js entered ###");
process.on("exit", (code) => console.log("### EXIT:", code));
setTimeout(() => console.log("### still alive after 2s ###"), 2000);