// =============================================================
//  입력값 검사 (화면은 누구나 조작할 수 있으니 → 서버에서 한 번 더 확인)
//  로컬 버전과 클라우드 버전이 똑같이 씁니다.
// =============================================================
const PRIORITIES = ['high', 'normal', 'low'];
const MOODS = ['😊', '😐', '😫'];

function httpError(status, message) { const e = new Error(message); e.status = status; return e; }

function optText(v, max, label) {
  if (v == null || String(v).trim() === '') return null;
  const s = String(v).trim();
  if (s.length > max) throw httpError(400, `${label}은(는) ${max}자까지 쓸 수 있어요.`);
  return s;
}

function optInt(v, min, max, label) {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw httpError(400, `${label} 값이 이상해요.`);
  return n;
}

function cleanTodoInput(body) {
  const title = String(body.title ?? '').trim();
  if (!title) throw httpError(400, '할 일 내용을 적어 주세요.');
  if (title.length > 200) throw httpError(400, '할 일은 200자까지 쓸 수 있어요.');
  const due_date = body.due_date ? String(body.due_date) : null;
  if (due_date && !/^\d{4}-\d{2}-\d{2}$/.test(due_date)) throw httpError(400, '마감일 형식이 이상해요.');
  const priority = body.priority || 'normal';
  if (!PRIORITIES.includes(priority)) throw httpError(400, '우선순위 값이 이상해요.');
  return {
    title,
    memo: optText(body.memo, 1000, '메모'),
    priority,
    due_date,
    estimated_minutes: optInt(body.estimated_minutes, 1, 1440, '예상 소요 시간'),
    category_id: optInt(body.category_id, 1, Number.MAX_SAFE_INTEGER, '카테고리'),
  };
}

function cleanDoneInput(body) {
  const done = !!body.done;
  const mood = done && body.mood ? String(body.mood) : null;
  if (mood && !MOODS.includes(mood)) throw httpError(400, '기분은 😊 😐 😫 중에서 골라 주세요.');
  return { done, mood };
}

function cleanCategoryInput(body) {
  const name = String(body.name ?? '').trim();
  if (!name) throw httpError(400, '카테고리 이름을 적어 주세요.');
  if (name.length > 20) throw httpError(400, '카테고리 이름은 20자까지예요.');
  const emoji = optText(body.emoji, 8, '이모지') || '📁';
  const color = body.color || '#7c6cf2';
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) throw httpError(400, '색 값이 이상해요.');
  return { name, emoji, color };
}

function cleanListQuery(url) {
  const q = (url.searchParams.get('q') || '').trim().slice(0, 100);
  const c = (url.searchParams.get('category') || '').trim();
  const category = c === 'none' ? 'none' : /^\d+$/.test(c) ? c : '';
  return { q, category };
}

module.exports = { httpError, cleanTodoInput, cleanDoneInput, cleanCategoryInput, cleanListQuery, MOODS };
