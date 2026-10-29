// =============================================================
//  길 B - Supabase(클라우드 Postgres) Todo 앱 백엔드
//  - 화면(public/index.html)은 이 서버의 /api/... 에만 요청합니다. (화면은 Supabase를 모름)
//  - Supabase 주소와 접속 키는 .env 에만 있고, 이 백엔드 코드만 읽습니다.
//  - 로그인은 Supabase Auth(검증된 인증 서비스)를 씁니다.
//  - 백엔드는 "로그인한 사용자의 토큰"을 그대로 Supabase에 넘깁니다.
//    → DB의 RLS 규칙이 "토큰 주인 = 행 주인(user_id)"인 행만 허락합니다.
//  - 설치할 패키지 없음 (Node 기본 기능 fetch 사용)
// =============================================================
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const V = require('./validate');

// ---------- .env 읽기 ----------
try { process.loadEnvFile(path.join(__dirname, '.env')); } catch { /* Render 등에서는 환경변수로 직접 들어옴 */ }

const PORT = Number(process.env.PORT) || 3001;
const SUPABASE_URL = (process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
const SUPABASE_KEY = (process.env.SUPABASE_KEY || '').trim();
const PUBLIC_DIR = path.join(__dirname, 'public');
const TZ = 'Asia/Seoul';

if (!/^https?:\/\//.test(SUPABASE_URL) || !SUPABASE_KEY || SUPABASE_KEY.includes('여기에')) {
  console.error('\n  [!] .env 파일에 SUPABASE_URL 과 SUPABASE_KEY 를 먼저 넣어 주세요. (따라하기 가이드 3단계)\n');
  process.exit(1);
}
if (/^sb_secret_/.test(SUPABASE_KEY) || jwtRole(SUPABASE_KEY) === 'service_role') {
  console.error('\n  [!] SUPABASE_KEY 에 secret / service_role 키를 넣으면 RLS가 무시돼요!');
  console.error('      Publishable key(또는 anon key)를 넣어 주세요.\n');
  process.exit(1);
}
function jwtRole(key) {
  try { return JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()).role || ''; } catch { return ''; }
}

// ---------- 날짜 도우미 (한국 시간 기준) ----------
const seoul = (d) => new Date(d).toLocaleString('sv-SE', { timeZone: TZ }).slice(0, 19);   // "2026-10-29 17:31:00"
const todaySeoul = () => seoul(Date.now()).slice(0, 10);
function addDay(ymd) { const d = new Date(ymd + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); }

// ---------- Supabase 호출 도우미 ----------
async function supa(pathAndQuery, { method = 'GET', token, body, prefer } = {}) {
  const headers = { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (prefer) headers.Prefer = prefer;
  let res;
  try {
    res = await fetch(SUPABASE_URL + pathAndQuery, { method, headers, body: body ? JSON.stringify(body) : undefined });
  } catch {
    throw V.httpError(502, 'Supabase에 연결할 수 없어요. 인터넷 연결과 .env의 SUPABASE_URL을 확인해 주세요.');
  }
  const text = await res.text();
  let data; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const msg = (data && (data.msg || data.message || data.error_description || data.error)) || `Supabase 오류 (${res.status})`;
    if (/Invalid API key/i.test(msg)) throw V.httpError(500, '.env의 SUPABASE_KEY가 맞지 않아요. 다시 복사해 주세요.');
    if (res.status === 401 || /JWT/i.test(msg)) throw V.httpError(401, '로그인이 만료됐어요. 다시 로그인해 주세요.');
    throw V.httpError(res.status >= 500 ? 502 : 400, translate(msg, data));
  }
  return data;
}

function translate(msg, data) {
  const m = String(msg);
  if (/Invalid login credentials/i.test(m)) return '이메일 또는 비밀번호가 맞지 않아요.';
  if (/Email not confirmed/i.test(m)) return '이메일 인증이 아직 안 됐어요. 메일함을 확인하거나, 가이드의 "이메일 인증 끄기"를 해 주세요.';
  if (/already registered|already been registered|already exists/i.test(m) && !/duplicate key/i.test(m)) return '이미 가입된 이메일이에요. 로그인해 주세요.';
  if (/Password should be/i.test(m)) return '비밀번호는 6자 이상이어야 해요.';
  if (/rate limit/i.test(m)) return '요청이 너무 많아요. 잠시 뒤 다시 해 주세요.';
  if (/duplicate key/i.test(m) || (data && data.code === '23505')) return '같은 이름의 카테고리가 이미 있어요.';
  if (/does not exist|Could not find the table|schema cache/i.test(m)) return 'Supabase에 표가 없어요. supabase-setup.sql 을 SQL Editor에서 먼저 실행해 주세요.';
  if (/row-level security/i.test(m)) return 'RLS 규칙에 막혔어요. (내 데이터가 아니에요)';
  if (/permission denied/i.test(m)) return '권한이 없어요. 로그인했는지, supabase-setup.sql 을 실행했는지 확인해 주세요.';
  return m;
}

function getToken(req) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
  if (!token) throw V.httpError(401, '먼저 로그인해 주세요.');
  return token;
}

// ---------- 할 일 / 카테고리 (모두 "로그인한 사람의 토큰"으로 호출 → RLS 적용) ----------
const PRIORITY_ORDER = { high: 0, normal: 1, low: 2 };

async function listTodos(token, { q, category }) {
  // SELECT todos.*, categories(name, emoji, color) FROM todos WHERE ... (RLS가 "내 것만" 자동 추가)
  let query = '/rest/v1/todos?select=*,categories(name,emoji,color)';
  if (category === 'none') query += '&category_id=is.null';
  else if (category) query += `&category_id=eq.${Number(category)}`;
  if (q) {
    const safe = q.replace(/[,()"*%\\:]/g, ' ').trim();
    if (safe) query += '&or=' + encodeURIComponent(`(title.ilike.*${safe}*,memo.ilike.*${safe}*)`);
  }
  const rows = await supa(query, { token });
  return rows
    .map(({ categories: c, user_id, ...t }) => ({
      ...t,
      created_at: seoul(t.created_at),
      completed_at: t.completed_at ? seoul(t.completed_at) : null,
      category_name: c ? c.name : null, category_emoji: c ? c.emoji : null, category_color: c ? c.color : null,
    }))
    .sort((a, b) =>
      (a.done - b.done) ||
      (PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]) ||
      ((a.due_date == null) - (b.due_date == null)) ||
      String(a.due_date).localeCompare(String(b.due_date)) ||
      (b.id - a.id));
}

async function listCategories(token) {
  const [cats, todos] = await Promise.all([
    supa('/rest/v1/categories?select=id,name,emoji,color&order=name', { token }),
    supa('/rest/v1/todos?select=category_id', { token }),
  ]);
  return cats.map((c) => ({ ...c, todo_count: todos.filter((t) => t.category_id === c.id).length }));
}

function sessionOut(s) {
  return { access_token: s.access_token, refresh_token: s.refresh_token, email: s.user && s.user.email };
}

function cleanAuthInput(body) {
  const email = String(body.email ?? '').trim();
  const password = String(body.password ?? '');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw V.httpError(400, '이메일 형식을 확인해 주세요.');
  if (password.length < 6) throw V.httpError(400, '비밀번호는 6자 이상이어야 해요.');
  return { email, password };
}

// ---------- API 라우팅 ----------
async function handleApi(req, res, url) {
  const p = url.pathname;
  const todoId = p.match(/^\/api\/todos\/(\d+)$/);
  const postponeId = p.match(/^\/api\/todos\/(\d+)\/postpone$/);
  const catId = p.match(/^\/api\/categories\/(\d+)$/);

  if (req.method === 'GET' && p === '/api/config') {
    return send(res, 200, { mode: 'supabase', authRequired: true, label: 'Supabase 클라우드 DB' });
  }

  // --- 회원가입 / 로그인 (Supabase Auth) ---
  if (req.method === 'POST' && p === '/api/signup') {
    const { email, password } = cleanAuthInput(await readJson(req));
    const data = await supa('/auth/v1/signup', { method: 'POST', body: { email, password } });
    if (data && data.access_token) return send(res, 200, sessionOut(data));
    return send(res, 200, { message: '가입 신청 완료! 이메일 인증이 켜져 있다면 메일함에서 인증한 뒤 로그인해 주세요.' });
  }
  if (req.method === 'POST' && p === '/api/login') {
    const { email, password } = cleanAuthInput(await readJson(req));
    const data = await supa('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password } });
    return send(res, 200, sessionOut(data));
  }
  if (req.method === 'POST' && p === '/api/refresh') {
    const { refresh_token } = await readJson(req);
    if (!refresh_token) throw V.httpError(401, '다시 로그인해 주세요.');
    const data = await supa('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: String(refresh_token) } });
    return send(res, 200, sessionOut(data));
  }

  // --- 아래는 전부 로그인 필요 ---
  const token = getToken(req);
  const one = (rows, msg) => { if (!rows || !rows.length) throw V.httpError(404, msg); return rows[0]; };
  const NOT_MINE = '그 할 일이 없거나, 내 할 일이 아니에요.';

  // 할 일
  if (req.method === 'GET' && p === '/api/todos') {
    return send(res, 200, await listTodos(token, V.cleanListQuery(url)));
  }
  if (req.method === 'POST' && p === '/api/todos') {
    // user_id 는 보내지 않아요 → DB가 auth.uid()(토큰 주인)로 자동 기록
    const row = one(await supa('/rest/v1/todos?select=id', {
      method: 'POST', token, prefer: 'return=representation', body: V.cleanTodoInput(await readJson(req)),
    }), '저장하지 못했어요.');
    return send(res, 201, { id: row.id });
  }
  if (req.method === 'PATCH' && todoId) {
    const { done, mood } = V.cleanDoneInput(await readJson(req));
    const body = done ? { done: true, mood, completed_at: new Date().toISOString() } : { done: false, mood: null, completed_at: null };
    // RLS 때문에 남의 할 일이면 0줄이 바뀜 → 거절
    one(await supa(`/rest/v1/todos?id=eq.${todoId[1]}&select=id`, { method: 'PATCH', token, prefer: 'return=representation', body }), NOT_MINE);
    return send(res, 200, { ok: true });
  }
  if (req.method === 'POST' && postponeId) {
    const id = postponeId[1];
    const t = one(await supa(`/rest/v1/todos?id=eq.${id}&done=is.false&select=due_date,postpone_count`, { token }), '그 할 일이 없거나 이미 완료됐어요.');
    const today = todaySeoul();
    const base = t.due_date && t.due_date > today ? t.due_date : today;   // 마감일이 없거나 지났으면 → 내일
    one(await supa(`/rest/v1/todos?id=eq.${id}&select=id`, {
      method: 'PATCH', token, prefer: 'return=representation',
      body: { due_date: addDay(base), postpone_count: t.postpone_count + 1 },
    }), NOT_MINE);
    return send(res, 200, { ok: true });
  }
  if (req.method === 'DELETE' && todoId) {
    one(await supa(`/rest/v1/todos?id=eq.${todoId[1]}&select=id`, { method: 'DELETE', token, prefer: 'return=representation' }), NOT_MINE);
    return send(res, 200, { ok: true });
  }

  // 카테고리
  if (req.method === 'GET' && p === '/api/categories') {
    return send(res, 200, await listCategories(token));
  }
  if (req.method === 'POST' && p === '/api/categories') {
    const row = one(await supa('/rest/v1/categories?select=id', {
      method: 'POST', token, prefer: 'return=representation', body: V.cleanCategoryInput(await readJson(req)),
    }), '저장하지 못했어요.');
    return send(res, 201, { id: row.id });
  }
  if (req.method === 'DELETE' && catId) {
    // 그 안의 할 일은 DB의 on delete set null 규칙으로 → 미분류
    one(await supa(`/rest/v1/categories?id=eq.${catId[1]}&select=id`, { method: 'DELETE', token, prefer: 'return=representation' }),
      '그 카테고리가 없거나, 내 카테고리가 아니에요.');
    return send(res, 200, { ok: true });
  }
  throw V.httpError(404, '없는 API예요.');
}

// ---------- 공통 도우미 ----------
function send(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 100_000) { reject(V.httpError(413, '요청이 너무 커요.')); req.destroy(); } });
    req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(V.httpError(400, 'JSON 형식이 아니에요.')); } });
    req.on('error', reject);
  });
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
function serveStatic(res, url) {
  const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
  const file = path.resolve(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 403, { error: '접근할 수 없어요.' });
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, { error: '파일이 없어요.' });
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) await handleApi(req, res, url);
    else serveStatic(res, url);
  } catch (e) {
    if (!e.status) console.error(e);
    send(res, e.status || 500, { error: e.status ? e.message : '서버에서 문제가 생겼어요.' });
  }
}).listen(PORT, () => {
  console.log('');
  console.log('  ✅ 클라우드(Supabase) Todo 앱이 켜졌어요!');
  console.log(`  👉 브라우저에서 http://localhost:${PORT} 을 열어 주세요.`);
  console.log(`  ☁️  데이터 저장 위치: ${SUPABASE_URL}`);
  console.log('  ⏹  끄려면 이 창에서 Ctrl + C');
  console.log('');
});
