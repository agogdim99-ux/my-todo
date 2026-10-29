# 📸 작동 캡처 (2026-10-29)

## 길 A - 로컬 SQLite (`todo.db`)
| 파일 | 확인한 것 |
|---|---|
| A1_로컬_서버_실행.png | 백엔드 서버 실행 (데이터 파일 `todo.db` 경로 표시) |
| A2_로컬_할일_추가.png | 할 일 추가 → 목록에 표시 |
| A3_로컬_껐다켠뒤에도_남음.png | 서버를 끄고 다시 켠 뒤에도 할 일이 남아 있음 |
| A4_로컬_DB뷰어_todos표.png | DB 뷰어로 `todo.db` 안 `todos` 표에 행이 실제로 저장된 것 확인 (`SELECT * FROM todos`) |
| A5_로컬_추가.png | 추가 (Create) |
| A6_로컬_삭제.png | 삭제 (Delete) - `빨래하기` 삭제됨 |
| A7_로컬_완료.png | 완료 (Update) - 완료 시각·"마감 전에 끝냄" 자동 기록 |

## 길 B - Supabase (클라우드 Postgres) + 로그인 + RLS
| 파일 | 확인한 것 |
|---|---|
| B1_클라우드_로그인화면.png | Supabase Auth 로그인 화면 (화면은 백엔드 API에만 요청) |
| B2_클라우드_로그인성공.png | 로그인 성공 (a@test.com) |
| B3_클라우드_할일_추가.png | 클라우드 DB에 할 일 추가 |
| B4_클라우드_삭제후_추가.png | 삭제 후 새 할 일 추가, 새로고침 후에도 유지 |
| B5_Supabase_저장확인_주인_RLS.jpg | Supabase SQL Editor: todos 행 + 주인(owner=a@test.com) + RLS 켜짐(rls_on=true) |
| B7_클라우드_완료.png | 완료 (Update) - 체크하면 완료 시각 자동 기록 |
| B8_클라우드_삭제.png | 삭제 (Delete) - 할 일 삭제 후 목록에서 사라짐 |
| B9_클라우드_서버_재시작.png | ① start 다시 실행 → ② 서버 재시작 후 같은 계정으로 다시 접속 (데이터는 Supabase에 있어서 서버를 꺼도 유지) |
| B6_RLS_테스트_모두통과.png | B 계정은 A 계정의 할 일 조회·수정·삭제 모두 거절, A의 할 일 그대로 → 🎉 모두 통과 |

## 확인 기록 (한 줄씩)
- [로컬 저장] SQLite(`todo.db`)에 추가·완료·삭제 확인, 새로고침·재시작 후에도 남음 ✅ / DB 뷰어로 todos 행 확인 ✅
- [클라우드 전환] 저장소를 Supabase(Postgres)로 전환. 화면 → 백엔드 API → Supabase 구조, 키는 `.env`에만 보관 ✅
- [클라우드 저장] Supabase에서 todos 행 확인(주인 user_id 자동 기록), 새로고침 후에도 남음 ✅
- [RLS] todos·categories RLS 켬(`auth.uid() = user_id`). B 계정에서 A의 할 일 조회·수정·삭제 모두 거절, A의 할 일 그대로 ✅
