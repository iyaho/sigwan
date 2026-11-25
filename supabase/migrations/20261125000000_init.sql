-- 시관 M2 — 서버 스키마 · RLS · 동기화 함수 (명세 5·7장, 부록 A.4)
--
-- Supabase 대시보드 SQL Editor에 통째로 붙여 넣고 Run. 다시 돌려도 되도록 IF NOT EXISTS / OR REPLACE로 썼다.
--
-- 원칙
--  * 로컬 DB가 원본이고 서버는 허브다 (7장). 행 모양은 packages/core/src/types.ts와 같다
--  * 기본키는 (user_id, id) — 앱의 옛 시간표 id가 'tt-legacy'로 고정이라 id만으로는 사용자끼리 부딪친다
--  * 사용자 테이블끼리 FK를 걸지 않는다. 동기화는 순서가 뒤섞여 도착하고(블록이 할 일보다 먼저), 지운 것도 툼스톤으로 남는다
--  * server_rev — 사용자별로 하나씩 오르는 번호. 기기는 "어디까지 받았나"만 기억한다 (7장 3번)
--  * 클라이언트가 보낸 user_id는 믿지 않는다. 서버가 auth.uid()로 덮는다 (10.1)

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. 테이블
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.tasks (
  user_id        uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id             text not null,
  title          text not null check (char_length(title) between 1 and 500),
  notes          text check (char_length(notes) <= 20000),
  kind           text not null check (kind in ('day', 'deadline', 'someday')),
  status         text not null default 'todo' check (status in ('todo', 'doing', 'done')),
  day_of         date,
  start_at       timestamptz,
  due_at         timestamptz,
  estimate_min   integer not null default 60 check (estimate_min between 0 and 43200),
  spent_min      integer not null default 0 check (spent_min >= 0),
  importance     smallint not null default 3 check (importance between 1 and 5),
  progress       real not null default 0 check (progress between 0 and 1),
  pinned         boolean not null default false,
  parent_id      text,
  rrule          text,
  sort_order     double precision not null default 0,
  score          double precision,
  source         text not null default 'manual' check (source in ('manual', 'quickadd', 'ai', 'import')),
  estimate_is_ai boolean not null default false,
  is_locked      boolean not null default false,
  enc_blob       bytea,
  created_at     timestamptz not null,
  updated_at     timestamptz not null,
  completed_at   timestamptz,
  deleted_at     timestamptz,
  server_rev     bigint not null,
  primary key (user_id, id)
);

create table if not exists public.blocks (
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id         text not null,
  task_id    text,
  title      text check (char_length(title) <= 500),
  start_at   timestamptz not null,
  end_at     timestamptz not null,
  is_all_day boolean not null default false,
  source     text not null default 'manual' check (source in ('manual', 'drag', 'timer', 'import')),
  deleted_at timestamptz,
  updated_at timestamptz not null,
  server_rev bigint not null,
  primary key (user_id, id),
  check (end_at > start_at)
);

-- 이름 UNIQUE는 서버에 걸지 않는다. 두 기기에서 같은 이름을 각자 만들면 동기화가 그 자리에서 멈춘다.
-- 겹치는 이름은 클라이언트가 막는다 (store addTag/updateTag)
create table if not exists public.tags (
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id         text not null,
  name       text not null check (char_length(name) between 1 and 50),
  color      text not null check (color ~ '^#[0-9a-fA-F]{6}$'),
  sort_order double precision not null default 0,
  deleted_at timestamptz,
  updated_at timestamptz not null,
  server_rev bigint not null,
  primary key (user_id, id)
);

-- 할 일 하나에 붙은 태그 전체. 연결 한 줄씩이 아니라 통째로 갈아끼운다 (core/sync.ts TaskTagsPayload)
create table if not exists public.task_tags (
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  task_id    text not null,
  tag_ids    text[] not null default '{}',
  updated_at timestamptz not null,
  server_rev bigint not null,
  primary key (user_id, task_id)
);

create table if not exists public.timetables (
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id          text not null,
  name        text not null check (char_length(name) between 1 and 60),
  active_from date,
  active_to   date,
  deleted_at  timestamptz,
  updated_at  timestamptz not null,
  server_rev  bigint not null,
  primary key (user_id, id)
);

create table if not exists public.routines (
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id           text not null,
  timetable_id text not null,
  name         text not null check (char_length(name) between 1 and 100),
  weekdays     smallint[] not null check (cardinality(weekdays) >= 1 and weekdays <@ '{0,1,2,3,4,5,6}'),
  start_min    smallint not null check (start_min between 0 and 1439),
  end_min      smallint not null check (end_min between 1 and 1440),
  color        text not null check (color ~ '^#[0-9a-fA-F]{6}$'),
  deleted_at   timestamptz,
  updated_at   timestamptz not null,
  server_rev   bigint not null,
  primary key (user_id, id),
  check (end_min > start_min)
);

-- id는 `${routine_id}:${day}` 계산값 (5.1). 웹과 앱이 같은 날 체크해도 같은 행이다
create table if not exists public.routine_checks (
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id         text not null,
  routine_id text not null,
  day        date not null,
  checked_at timestamptz not null,
  deleted_at timestamptz,
  updated_at timestamptz not null,
  server_rev bigint not null,
  primary key (user_id, id)
);

create table if not exists public.settings (
  user_id         uuid not null default auth.uid() references auth.users (id) on delete cascade,
  sleep           jsonb not null,
  weight_urgent   real not null default 0.6 check (weight_urgent between 0 and 1),
  half_life_hours real not null default 48 check (half_life_hours between 6 and 240),
  gap_min         smallint not null default 10 check (gap_min between 0 and 60),
  updated_at      timestamptz not null,
  server_rev      bigint not null,
  primary key (user_id)
);

-- 사용자별 rev 카운터. 이 행을 잠그고 번호를 받으므로 같은 사용자의 쓰기는 번호 순서대로 커밋된다 —
-- 그래야 "rev > 커서"로 받아가는 쪽이 늦게 커밋된 작은 번호를 건너뛰지 않는다
create table if not exists public.sync_state (
  user_id uuid primary key references auth.users (id) on delete cascade,
  rev     bigint not null default 0
);

create index if not exists tasks_rev          on public.tasks          (user_id, server_rev);
create index if not exists blocks_rev         on public.blocks         (user_id, server_rev);
create index if not exists tags_rev           on public.tags           (user_id, server_rev);
create index if not exists task_tags_rev      on public.task_tags      (user_id, server_rev);
create index if not exists timetables_rev     on public.timetables     (user_id, server_rev);
create index if not exists routines_rev       on public.routines       (user_id, server_rev);
create index if not exists routine_checks_rev on public.routine_checks (user_id, server_rev);
create index if not exists settings_rev       on public.settings       (user_id, server_rev);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. server_rev — 쓸 때마다 사용자 카운터에서 받는다
-- ─────────────────────────────────────────────────────────────────────────────

-- security definer: sync_state는 클라이언트가 직접 못 쓴다(RLS 정책 없음). 이 트리거만 쓴다.
-- new.user_id를 그대로 믿어도 되는 이유 — 본 테이블의 RLS WITH CHECK가 남의 user_id를 거절하면
-- 문장 전체가 취소되고 여기서 올린 번호도 같이 되돌아간다
create or replace function public.bump_server_rev() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.sync_state as s (user_id, rev) values (new.user_id, 1)
  on conflict (user_id) do update set rev = s.rev + 1
  returning s.rev into new.server_rev;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['tasks','blocks','tags','task_tags','timetables','routines','routine_checks','settings'] loop
    execute format('drop trigger if exists bump_rev on public.%I', t);
    execute format('create trigger bump_rev before insert or update on public.%I
                    for each row execute function public.bump_server_rev()', t);
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. RLS — 자기 행만 (부록 A.4). 이 블록이 빠지면 publishable 키로 누구나 남의 데이터를 읽는다
-- ─────────────────────────────────────────────────────────────────────────────
--  * DELETE 정책은 없다 — 클라이언트는 지우지 않고 툼스톤을 쓴다. 계정 삭제는 auth.users CASCADE
--  * UPDATE에 WITH CHECK — 없으면 내 행의 user_id를 남의 것으로 바꿔 밀어넣을 수 있다 (A.4 실수 1번)
--  * (select auth.uid()) — 감싸지 않으면 행마다 다시 계산한다 (A.4 실수 4번)

do $$
declare t text;
begin
  foreach t in array array['tasks','blocks','tags','task_tags','timetables','routines','routine_checks','settings'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists own_select on public.%I', t);
    execute format('drop policy if exists own_insert on public.%I', t);
    execute format('drop policy if exists own_update on public.%I', t);
    execute format('create policy own_select on public.%I for select to authenticated
                    using (user_id = (select auth.uid()))', t);
    execute format('create policy own_insert on public.%I for insert to authenticated
                    with check (user_id = (select auth.uid()))', t);
    execute format('create policy own_update on public.%I for update to authenticated
                    using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t);
  end loop;
end $$;

alter table public.sync_state enable row level security;
drop policy if exists own_select on public.sync_state;
create policy own_select on public.sync_state for select to authenticated
  using (user_id = (select auth.uid()));

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. sync_push — outbox를 올린다
-- ─────────────────────────────────────────────────────────────────────────────
-- changes: [{ "seq": 12, "table": "tasks", "row": { ...행 전체 }, "base_rev": 340 }, ...]  (core/sync.ts)
-- 돌려줌:  { "applied": [12, ...], "rejected": [{ "seq": 13, "error": "..." }], "rev": 345 }
--
-- base_rev = 그 기기가 이 행에 대해 마지막으로 받은 server_rev (모르면 생략)
--   * base_rev >= 서버의 server_rev → 최신을 보고 고친 것. 그대로 반영한다 (체크 해제도 된다)
--   * 그 밖 → 동시에 고친 충돌. 7장 규칙 — 레코드 LWW(updated_at), 예외 둘:
--       tasks.status는 done이 이긴다 (모르고 고친 옛 행이 끝낸 것을 되살리지 않게)
--       tasks.spent_min은 큰 값이 이긴다
--   "done이 무조건 이긴다"로 두면 다른 기기에서 일부러 체크를 푼 것까지 서버가 되돌린다 — 그래서 충돌일 때만
--
-- 한 줄씩 격리한다. 한 줄이 제약에 걸려도 나머지는 들어가고, 걸린 줄은 rejected로 돌려준다 —
-- 그 한 줄 때문에 outbox 전체가 영영 막히면 안 된다. 클라이언트는 rejected를 지우고 기록만 남긴다
create or replace function public.sync_push(changes jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  uid      uuid := auth.uid();
  c        jsonb;
  tbl      text;
  keycol   text;
  incoming jsonb;
  cur      jsonb;
  merged   jsonb;
  setlist  text;
  applied  jsonb := '[]';
  rejected jsonb := '[]';
begin
  if uid is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  if jsonb_typeof(changes) <> 'array' or jsonb_array_length(changes) > 500 then
    raise exception 'changes must be an array of at most 500' using errcode = '22023';
  end if;

  for c in select value from jsonb_array_elements(changes) loop
    begin
      tbl := c->>'table';
      keycol := case tbl
        when 'tasks' then 'id' when 'blocks' then 'id' when 'tags' then 'id'
        when 'timetables' then 'id' when 'routines' then 'id' when 'routine_checks' then 'id'
        when 'task_tags' then 'task_id'
        when 'settings' then null
        else 'unknown' end;
      if keycol = 'unknown' then
        raise exception 'unknown table %', tbl;
      end if;

      -- 클라이언트의 user_id('local-user' 등)는 버리고 서버가 정한다. rev는 로컬 전용이라 버린다
      incoming := (c->'row') - 'rev' - 'server_rev' || jsonb_build_object('user_id', uid);
      if (incoming->>'updated_at') is null then
        raise exception 'updated_at is required';
      end if;

      if keycol is null then
        execute format('select to_jsonb(t) from public.%I t where t.user_id = $1', tbl)
          into cur using uid;
      else
        execute format('select to_jsonb(t) from public.%I t where t.user_id = $1 and t.%I = $2', tbl, keycol)
          into cur using uid, incoming->>keycol;
      end if;

      if cur is null
         or coalesce((c->>'base_rev')::bigint, -1) >= (cur->>'server_rev')::bigint then
        -- 처음 보는 행이거나, 최신을 보고 고친 것
        merged := coalesce(cur, '{}') || incoming;
      else
        -- 충돌: 나중에 고친 쪽(updated_at)이 이긴다
        if (incoming->>'updated_at')::timestamptz > (cur->>'updated_at')::timestamptz then
          merged := cur || incoming;
        else
          merged := cur;
        end if;
        if tbl = 'tasks' then
          if merged->>'status' <> 'done' and (cur->>'status' = 'done' or incoming->>'status' = 'done') then
            merged := merged || jsonb_build_object(
              'status', 'done',
              'completed_at', case when cur->>'status' = 'done' then cur->'completed_at' else incoming->'completed_at' end);
          end if;
          merged := merged || jsonb_build_object('spent_min',
            greatest(coalesce((cur->>'spent_min')::int, 0), coalesce((incoming->>'spent_min')::int, 0)));
        end if;
      end if;

      -- 테이블 형식으로 맞춘 뒤 비교한다. 안 그러면 '…Z'와 '…+00:00'처럼 표기만 다른 값을 바뀐 것으로 보고
      -- 재시도마다 server_rev가 올라 모든 기기가 같은 행을 또 받아간다
      execute format('select to_jsonb(jsonb_populate_record(null::public.%I, $1))', tbl) into merged using merged;
      if cur is null or merged - 'server_rev' is distinct from cur - 'server_rev' then
        select string_agg(format('%I = excluded.%I', a.attname, a.attname), ', ')
          into setlist
          from pg_attribute a
         where a.attrelid = format('public.%I', tbl)::regclass
           and a.attnum > 0 and not a.attisdropped
           and a.attname not in ('user_id', 'server_rev')
           and (keycol is null or a.attname <> keycol);
        execute format(
          'insert into public.%1$I select * from jsonb_populate_record(null::public.%1$I, $1)
           on conflict (%2$s) do update set %3$s',
          tbl,
          case when keycol is null then 'user_id' else format('user_id, %I', keycol) end,
          setlist)
          using merged;
      end if;

      applied := applied || to_jsonb(c->'seq');
    exception when others then
      rejected := rejected || jsonb_build_object('seq', c->'seq', 'error', sqlerrm);
    end;
  end loop;

  return jsonb_build_object(
    'applied', applied,
    'rejected', rejected,
    'rev', coalesce((select s.rev from public.sync_state s where s.user_id = uid), 0));
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. sync_pull — 커서 이후 바뀐 것만 받는다
-- ─────────────────────────────────────────────────────────────────────────────
-- 돌려줌: { "changes": [{ "table": "tasks", "row": {...} }, ...], "rev": 다음 커서, "more": 더 있나 }
-- more가 true면 받은 rev로 다시 부른다. 행에는 server_rev가 빠져 있다 — 로컬은 그 값을 모른다
create or replace function public.sync_pull(since bigint, max_rows integer default 1000) returns jsonb
language sql stable security invoker set search_path = '' as $$
  with uid as (select auth.uid() as id),
  ch as (
    select 'tasks' as tbl, t.server_rev, to_jsonb(t) as row from public.tasks t, uid where t.user_id = uid.id and t.server_rev > since
    union all select 'blocks', t.server_rev, to_jsonb(t) from public.blocks t, uid where t.user_id = uid.id and t.server_rev > since
    union all select 'tags', t.server_rev, to_jsonb(t) from public.tags t, uid where t.user_id = uid.id and t.server_rev > since
    union all select 'task_tags', t.server_rev, to_jsonb(t) from public.task_tags t, uid where t.user_id = uid.id and t.server_rev > since
    union all select 'timetables', t.server_rev, to_jsonb(t) from public.timetables t, uid where t.user_id = uid.id and t.server_rev > since
    union all select 'routines', t.server_rev, to_jsonb(t) from public.routines t, uid where t.user_id = uid.id and t.server_rev > since
    union all select 'routine_checks', t.server_rev, to_jsonb(t) from public.routine_checks t, uid where t.user_id = uid.id and t.server_rev > since
    union all select 'settings', t.server_rev, to_jsonb(t) from public.settings t, uid where t.user_id = uid.id and t.server_rev > since
  ),
  page as (
    select * from ch order by server_rev limit least(greatest(max_rows, 1), 5000)
  )
  select jsonb_build_object(
    'changes', coalesce(jsonb_agg(jsonb_build_object('table', tbl, 'row', row - 'server_rev') order by server_rev), '[]'),
    'rev', coalesce(max(server_rev), since),
    'more', count(*) = least(greatest(max_rows, 1), 5000))
  from page
$$;

revoke all on function public.sync_push(jsonb) from public, anon;
revoke all on function public.sync_pull(bigint, integer) from public, anon;
revoke all on function public.bump_server_rev() from public, anon, authenticated;
grant execute on function public.sync_push(jsonb) to authenticated;
grant execute on function public.sync_pull(bigint, integer) to authenticated;
