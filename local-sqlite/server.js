// =============================================================
//  길 A - 내 컴퓨터(로컬) Todo 앱 백엔드
//  - DB: SQLite 파일 하나(todo.db)  ← Node에 들어있는 node:sqlite 사용 (설치할 것 없음)
//  - 화면(public/index.html)은 이 서버의 /api/... 에만 요청합니다.
//  - DB에 접근하는 코드는 오직 이 파일(백엔드)에만 있습니다.
// =============================================================
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const V = require('./validate');

const PORT = Number(process.env.PORT) || 3000;
const DB_FILE = path.join(__dirname, 'todo.db');
const PUBLIC_DIR = path.join(__dirname, 'public');

// ---------- 1) DB 준비: 표(테이블) 2개 만들기 ----------
const db = new DatabaseSync(DB_FILE);
db.exec(`
  PRAGMA foreign_keys = ON;

  -- 카테고리 표
  CREATE TABLE IF NOT EXISTS categories (
    id    INTEGER PRIMARY KEY AUTOINCREMENT,
    name  TEXT NOT NULL UNIQUE,                 -- 같은 이름 중복 X
    emoji TEXT NOT NULL DEFAULT '📁',
    color TEXT NOT NULL DEFAULT '#7c6cf2'
  );

  -- 할 일 표
  CREATE TABLE IF NOT EXISTS todos (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    title             TEXT    NOT NULL,
    memo              TEXT,
    priority          TEXT    NOT NULL DEFAULT 'normal' CHECK (priority IN ('high','normal','low')),
    done              INTEGER NOT NULL DEFAULT 0,          -- 0 = 진행 중, 1 = 완료
    due_date          TEXT,                                -- 마감일 YYYY-MM-DD
    created_at        TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
    completed_at      TEXT,                                -- 완료한 날짜 (체크할 때 자동)
    mood              TEXT,                                -- 완료 기분 😊 😐 😫
    estimated_minutes INTEGER,                             -- 예상 소요 시간(분)
    postpone_count    INTEGER NOT NULL DEFAULT 0,          -- 미룬 횟수
    -- 카테고리 하나 : 할 일 여러 개 (일대다). 카테고리를 지우면 NULL(미분류)이 됨
    category_id       INTEGER REFERENCES categories(id) ON DELETE SET NULL
  );
`);

// ---------- 2) SQL 문 (전부 ? 자리표시자 → SQL 주입 방지) ----------
const sql = {
  insertTodo: db.prepare(`
    INSERT INTO todos (title, memo, priority, due_date, estimated_minutes, category_id)
    VALUES (?, ?, ?, ?, ?, ?)`),
  complete: db.prepare(`
    UPDATE todos SET done = 1, mood = ?, completed_at = datetime('now','localtime') WHERE id = ?`),
  uncomplete: db.prepare(`
    UPDATE todos SET done = 0, mood = NULL, completed_at = NULL WHERE id = ?`),
  // 내일로 미루기: 마감일이 없거나 지났으면 → 내일, 아니면 → 마감일 + 1일
  postpone: db.prepare(`
    UPDATE todos
    SET due_date = date(max(coalesce(due_date, date('now','localtime')), date('now','localtime')), '+1 day'),
        postpone_count = postpone_count + 1
    WHERE id = ? AND done = 0`),
  deleteTodo: db.prepare('DELETE FROM todos WHERE id = ?'),
  categoryExists: db.prepare('SELECT 1 FROM categories WHERE id = ?'),
  insertCategory: db.prepare('INSERT INTO categories (name, emoji, color) VALUES (?, ?, ?)'),
  deleteCategory: db.prepare('DELETE FROM categories WHERE id = ?'),
  listCategories: db.prepare(`
    SELECT c.id, c.name, c.emoji, c.color, COUNT(t.id) AS todo_count
    FROM categories c LEFT JOIN todos t ON t.category_id = c.id
    GROUP BY c.id ORDER BY c.name`),
};

// 목록 조회: SELECT ... FROM todos LEFT JOIN categories ... WHERE (검색어/카테고리 조건)
function listTodos({ q, category }) {
  const where = [];
  const params = [];
  if (q) { where.push('(t.title LIKE ? OR t.memo LIKE ?)'); params.push(`%${q}%`, `%${q}%`); }
  if (category === 'none') where.push('t.category_id IS NULL');
  else if (category) { where.push('t.category_id = ?'); params.push(Number(category)); }
  const query = `
    SELECT t.*, c.name AS category_name, c.emoji AS category_emoji, c.color AS category_color
    FROM todos t LEFT JOIN categories c ON c.id = t.category_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY t.done ASC,
             CASE t.priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,
             (t.due_date IS NULL), t.due_date, t.id DESC`;
  return db.prepare(query).all(...params).map((t) => ({ ...t, done: !!t.done }));
}

// ---------- 3) API 라우팅 ----------
async function handleApi(req, res, url) {
  const p = url.pathname;
  const todoId = p.match(/^\/api\/todos\/(\d+)$/);
  const postponeId = p.match(/^\/api\/todos\/(\d+)\/postpone$/);
  const catId = p.match(/^\/api\/categories\/(\d+)$/);

  if (req.method === 'GET' && p === '/api/config') {
    return send(res, 200, { mode: 'local', authRequired: false, label: '로컬 SQLite (todo.db)' });
  }

  // --- 할 일 ---
  if (req.method === 'GET' && p === '/api/todos') {
    return send(res, 200, listTodos(V.cleanListQuery(url)));
  }
  if (req.method === 'POST' && p === '/api/todos') {
    const t = V.cleanTodoInput(await readJson(req));
    if (t.category_id && !sql.categoryExists.get(t.category_id)) throw V.httpError(400, '없는 카테고리예요.');
    const r = sql.insertTodo.run(t.title, t.memo, t.priority, t.due_date, t.estimated_minutes, t.category_id);
    return send(res, 201, { id: Number(r.lastInsertRowid) });
  }
  if (req.method === 'PATCH' && todoId) {
    const { done, mood } = V.cleanDoneInput(await readJson(req));
    const r = done ? sql.complete.run(mood, Number(todoId[1])) : sql.uncomplete.run(Number(todoId[1]));
    if (r.changes === 0) throw V.httpError(404, '그 할 일을 찾을 수 없어요.');
    return send(res, 200, { ok: true });
  }
  if (req.method === 'POST' && postponeId) {
    const r = sql.postpone.run(Number(postponeId[1]));
    if (r.changes === 0) throw V.httpError(404, '그 할 일이 없거나 이미 완료됐어요.');
    return send(res, 200, { ok: true });
  }
  if (req.method === 'DELETE' && todoId) {
    const r = sql.deleteTodo.run(Number(todoId[1]));
    if (r.changes === 0) throw V.httpError(404, '그 할 일을 찾을 수 없어요.');
    return send(res, 200, { ok: true });
  }

  // --- 카테고리 ---
  if (req.method === 'GET' && p === '/api/categories') {
    return send(res, 200, sql.listCategories.all());
  }
  if (req.method === 'POST' && p === '/api/categories') {
    const c = V.cleanCategoryInput(await readJson(req));
    try {
      const r = sql.insertCategory.run(c.name, c.emoji, c.color);
      return send(res, 201, { id: Number(r.lastInsertRowid) });
    } catch (e) {
      if (/UNIQUE/.test(e.message)) throw V.httpError(400, '같은 이름의 카테고리가 이미 있어요.');
      throw e;
    }
  }
  if (req.method === 'DELETE' && catId) {
    const r = sql.deleteCategory.run(Number(catId[1]));   // 그 안의 할 일은 ON DELETE SET NULL → 미분류
    if (r.changes === 0) throw V.httpError(404, '그 카테고리를 찾을 수 없어요.');
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

// ---------- DB 뷰어 페이지: todo.db 파일 안의 표를 SQL로 직접 꺼내서 보여 줌 (읽기 전용) ----------
function dbViewer(res) {
  const esc = (v) => String(v ?? 'NULL').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const table = (name) => {
    const query = `SELECT * FROM ${name} ORDER BY id`;
    const cols = db.prepare(`PRAGMA table_info(${name})`).all().map((c) => c.name);
    const rows = db.prepare(query).all();
    return `<h2>📋 ${name} 표 <small>(${rows.length}행)</small></h2>
      <code>${query};</code>
      <div class="scroll"><table><tr>${cols.map((c) => `<th>${esc(c)}</th>`).join('')}</tr>
      ${rows.map((r) => `<tr>${cols.map((c) => `<td class="${r[c] == null ? 'null' : ''}">${esc(r[c])}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${cols.length}" class="null">(아직 행이 없어요)</td></tr>`}
      </table></div>`;
  };
  const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>DB 뷰어 - todo.db</title><style>
  body{margin:0;background:#f6f4ff;color:#2b2840;font-family:"Malgun Gothic",system-ui,sans-serif}
  .wrap{max-width:1000px;margin:0 auto;padding:28px 16px}
  h1{margin:0 0 4px}.sub{color:#8a86a3;margin:0 0 20px;word-break:break-all}
  h2{font-size:18px;margin:26px 0 6px}small{color:#8a86a3;font-weight:400}
  code{display:inline-block;background:#2b2840;color:#c9f7d8;padding:6px 10px;border-radius:8px;font-size:13px}
  .scroll{overflow-x:auto;margin-top:10px}
  table{border-collapse:collapse;background:#fff;font-size:13px;min-width:100%}
  th,td{border:1px solid #e7e3f7;padding:6px 10px;text-align:left;white-space:nowrap}
  th{background:#eeebff;color:#7c6cf2}td.null{color:#b9b5cc;font-style:italic}
  a{color:#7c6cf2}</style></head><body><div class="wrap">
  <h1>🗄️ DB 뷰어</h1>
  <p class="sub">💾 파일: ${esc(DB_FILE)}<br>화면이 아니라 <b>todo.db 파일 안</b>에 실제로 저장된 행이에요. · <a href="/">← 앱으로</a></p>
  ${table('todos')}${table('categories')}
  <p class="sub" style="margin-top:24px">조회 시각: ${esc(new Date().toLocaleString('ko-KR'))}</p>
  </div></body></html>`;
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname === '/db') return dbViewer(res);
    if (url.pathname.startsWith('/api/')) await handleApi(req, res, url);
    else serveStatic(res, url);
  } catch (e) {
    if (!e.status) console.error(e);
    send(res, e.status || 500, { error: e.status ? e.message : '서버에서 문제가 생겼어요.' });
  }
}).listen(PORT, () => {
  console.log('');
  console.log('  ✅ 로컬 Todo 앱이 켜졌어요!');
  console.log(`  👉 브라우저에서 http://localhost:${PORT} 을 열어 주세요.`);
  console.log(`  💾 데이터 파일: ${DB_FILE}`);
  console.log(`  🗄️  DB 뷰어: http://localhost:${PORT}/db`);
  console.log('  ⏹  끄려면 이 창에서 Ctrl + C');
  console.log('');
});
