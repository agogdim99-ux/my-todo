// =============================================================
//  RLS 확인 테스트: "B 계정은 A 계정의 할 일을 보거나·바꾸거나·지울 수 없다"
//  사용법: 앱(start.bat)을 켜 둔 상태에서 rls-test.bat 을 더블클릭
//         (또는 터미널에서  node rls-test.js)
//  결과 화면을 캡처해서 과제에 "RLS 확인 기록"으로 넣으세요.
// =============================================================
const BASE = process.env.APP_URL || 'http://localhost:3001';

async function call(path, { method = 'GET', token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

async function login(email, password) {
  let r = await call('/api/login', { method: 'POST', body: { email, password } });
  if (r.status === 200) return r.data.access_token;
  r = await call('/api/signup', { method: 'POST', body: { email, password } });
  if (r.data.access_token) return r.data.access_token;
  throw new Error(`${email} 로그인 실패: ${r.data.error || r.data.message}`);
}

(async () => {
  // 질문 없이 테스트 전용 계정 2개를 자동으로 씀 (없으면 자동 가입)
  const [aE, aP, bE, bP] = process.argv.slice(2);
  const A = { email: aE || 'rls-a@test.com', password: aP || 'test1234' };
  const B = { email: bE || 'rls-b@test.com', password: bP || 'test1234' };

  const results = [];
  const check = (name, pass, detail) => { results.push(pass); console.log(`${pass ? '✅ 통과' : '❌ 실패'}  ${name}  ${detail}`); };

  console.log(`\n=== RLS 확인 테스트 (${new Date().toLocaleString('ko-KR')}) ===\n`);
  const tokenA = await login(A.email, A.password);
  const tokenB = await login(B.email, B.password);
  console.log(`A = ${A.email}\nB = ${B.email}\n`);

  // 1) A가 카테고리와 할 일을 만든다
  const cat = await call('/api/categories', { method: 'POST', token: tokenA, body: { name: `rls테스트${Date.now() % 10000}`, emoji: '🔒' } });
  const catId = cat.data.id;
  const title = `[RLS 테스트] A의 비밀 할 일 ${Date.now() % 10000}`;
  const made = await call('/api/todos', { method: 'POST', token: tokenA, body: { title, category_id: catId } });
  const id = made.data.id;
  check('A가 카테고리·할 일 추가', made.status === 201 && cat.status === 201, `(할 일 id=${id}, 카테고리 id=${catId})`);

  // 2) B의 목록에 A의 할 일이 보이면 안 된다
  const listB = await call('/api/todos', { token: tokenB });
  check('B 목록에 A의 할 일 안 보임', listB.status === 200 && !listB.data.some((t) => t.id === id), `(B가 본 할 일 ${listB.data.length}개)`);

  // 3) B가 A의 할 일을 완료로 바꾸려 하면 거절
  const patchB = await call(`/api/todos/${id}`, { method: 'PATCH', token: tokenB, body: { done: true } });
  check('B가 A의 할 일 수정 → 거절', patchB.status !== 200, `(응답 ${patchB.status}: ${patchB.data.error || ''})`);

  // 4) B가 A의 할 일을 지우려 하면 거절
  const delB = await call(`/api/todos/${id}`, { method: 'DELETE', token: tokenB });
  check('B가 A의 할 일 삭제 → 거절', delB.status !== 200, `(응답 ${delB.status}: ${delB.data.error || ''})`);

  // 4-1) B는 A의 카테고리를 보거나, 자기 할 일에 붙이거나, 지울 수 없다
  const catsB = await call('/api/categories', { token: tokenB });
  check('B 카테고리 목록에 A의 카테고리 안 보임', catsB.status === 200 && !catsB.data.some((c) => c.id === catId), '');
  const stealCat = await call('/api/todos', { method: 'POST', token: tokenB, body: { title: 'A 카테고리 훔치기', category_id: catId } });
  check('B가 A의 카테고리를 붙이려 함 → 거절', stealCat.status !== 201, `(응답 ${stealCat.status}: ${stealCat.data.error || ''})`);
  const delCatB = await call(`/api/categories/${catId}`, { method: 'DELETE', token: tokenB });
  check('B가 A의 카테고리 삭제 → 거절', delCatB.status !== 200, `(응답 ${delCatB.status}: ${delCatB.data.error || ''})`);

  // 5) 로그인 안 한 사람은 아무것도 못 본다
  const anon = await call('/api/todos');
  check('로그인 없이 조회 → 거절', anon.status === 401, `(응답 ${anon.status})`);

  // 6) A가 다시 보면 원래 할 일이 그대로 (완료 안 됨, 안 지워짐)
  const listA = await call('/api/todos', { token: tokenA });
  const mine = listA.data.find((t) => t.id === id);
  check('A의 할 일은 그대로', !!mine && mine.done === false, mine ? `(done=${mine.done})` : '(사라짐!)');

  // 뒷정리: A가 자기 테스트 할 일 삭제
  const delA = await call(`/api/todos/${id}`, { method: 'DELETE', token: tokenA });
  check('A는 자기 할 일 삭제 가능', delA.status === 200, '');
  await call(`/api/categories/${catId}`, { method: 'DELETE', token: tokenA });

  const ok = results.every(Boolean);
  console.log(`\n${ok ? '🎉 모두 통과! RLS가 제대로 동작해요.' : '⚠️ 실패한 항목이 있어요. 결과를 Claude에게 보여 주세요.'}\n`);
})().catch((e) => {
  console.error('\n⚠️ 테스트를 못 했어요:', e.message);
  console.error('   앱(start.bat)이 켜져 있는지, 이메일 인증 끄기를 했는지 확인해 주세요.\n');
});
