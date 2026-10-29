-- =============================================================
--  Supabase 설정 SQL
--  사용법: Supabase 대시보드 → 왼쪽 메뉴 SQL Editor → 이 파일 내용 전부 붙여넣기 → Run
--  (여러 번 실행해도 괜찮아요)
--
--  만드는 것
--   1) 표 2개: categories(카테고리), todos(할 일)
--      → 두 표 모두 user_id(주인) 칸이 있고, 로그인한 사람이 자동으로 기록돼요.
--   2) RLS(행 수준 보안) 켜기 + 규칙: "로그인한 사람은 자기 행만" 조회·추가·수정·삭제
-- =============================================================

-- ---------- 1) 표 만들기 ----------
create table if not exists public.categories (
  id      bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name    text not null check (char_length(name) between 1 and 20),
  emoji   text not null default '📁',
  color   text not null default '#7c6cf2' check (color ~ '^#[0-9a-fA-F]{6}$'),
  unique (user_id, name)                          -- 내 카테고리끼리 같은 이름 중복 X
);

create table if not exists public.todos (
  id                bigint generated always as identity primary key,
  user_id           uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title             text not null check (char_length(title) between 1 and 200),
  memo              text check (char_length(memo) <= 1000),
  priority          text not null default 'normal' check (priority in ('high', 'normal', 'low')),
  done              boolean not null default false,
  due_date          date,
  created_at        timestamptz not null default now(),
  completed_at      timestamptz,
  mood              text check (mood in ('😊', '😐', '😫')),
  estimated_minutes int check (estimated_minutes between 1 and 1440),
  postpone_count    int not null default 0,
  -- 카테고리 하나 : 할 일 여러 개. 카테고리를 지우면 NULL(미분류)
  category_id       bigint references public.categories(id) on delete set null
);

create index if not exists todos_user_id_idx      on public.todos (user_id);
create index if not exists todos_category_id_idx  on public.todos (category_id);
create index if not exists categories_user_id_idx on public.categories (user_id);

-- ---------- 2) 권한: 로그인 안 한 사람(anon)은 아예 못 쓰게, 로그인한 사람(authenticated)만 ----------
revoke all on public.todos, public.categories from anon;
grant select, insert, update, delete on public.todos, public.categories to authenticated;

-- ---------- 3) RLS 켜기 ----------
alter table public.categories enable row level security;
alter table public.todos      enable row level security;

-- ---------- 4) RLS 규칙 ----------
-- categories: auth.uid()(지금 로그인한 사람) = user_id(주인) 인 행만
drop policy if exists "categories: 내 것만 보기" on public.categories;
drop policy if exists "categories: 내 것만 추가" on public.categories;
drop policy if exists "categories: 내 것만 수정" on public.categories;
drop policy if exists "categories: 내 것만 삭제" on public.categories;
create policy "categories: 내 것만 보기" on public.categories for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "categories: 내 것만 추가" on public.categories for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "categories: 내 것만 수정" on public.categories for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "categories: 내 것만 삭제" on public.categories for delete to authenticated
  using ((select auth.uid()) = user_id);

-- todos: 내 할 일만 + 카테고리를 붙일 땐 "내 카테고리"만 붙일 수 있게
drop policy if exists "todos: 내 것만 보기" on public.todos;
drop policy if exists "todos: 내 것만 추가" on public.todos;
drop policy if exists "todos: 내 것만 수정" on public.todos;
drop policy if exists "todos: 내 것만 삭제" on public.todos;
create policy "todos: 내 것만 보기" on public.todos for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "todos: 내 것만 추가" on public.todos for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and (category_id is null or exists (
      select 1 from public.categories c where c.id = category_id and c.user_id = (select auth.uid())))
  );
create policy "todos: 내 것만 수정" on public.todos for update to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and (category_id is null or exists (
      select 1 from public.categories c where c.id = category_id and c.user_id = (select auth.uid())))
  );
create policy "todos: 내 것만 삭제" on public.todos for delete to authenticated
  using ((select auth.uid()) = user_id);

-- ---------- 5) 확인: RLS가 켜졌는지 (rowsecurity 가 둘 다 true 면 성공!) ----------
select tablename, rowsecurity from pg_tables
where schemaname = 'public' and tablename in ('categories', 'todos');
