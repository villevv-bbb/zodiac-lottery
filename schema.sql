-- ============================================================
-- 财富密码 · 访问统计建表脚本
-- 在 Supabase 控制台 → SQL Editor → 粘贴执行
-- ============================================================

-- 1. 主表：每次进入页面 = 一条记录
create table if not exists public.visits (
  id               bigserial primary key,
  site             text        not null default 'zodiac-lottery',
  page             text,
  ip               text,
  location         text,
  visitor_id       text,
  session_id       text,
  is_new_visitor   boolean     default true,
  is_new_session   boolean     default true,
  referrer         text,
  device           text,
  os               text,
  browser          text,
  screen           text,
  ua               text,
  duration         integer     default 0,   -- 停留秒数
  max_scroll       integer     default 0,   -- 最大滚动百分比
  did_draw         boolean     default false,
  entered_at       timestamptz default now(),
  left_at          timestamptz
);

-- 2. 索引（看板查询用）
create index if not exists idx_visits_entered on public.visits (entered_at desc);
create index if not exists idx_visits_ip      on public.visits (ip);
create index if not exists idx_visits_visitor on public.visits (visitor_id);
create index if not exists idx_visits_session on public.visits (session_id);

-- 3. 开启 RLS（行级安全）
alter table public.visits enable row level security;

-- 4. 策略：匿名前端可插入
drop policy if exists "anon insert visits" on public.visits;
create policy "anon insert visits"
  on public.visits for insert
  to anon
  with check (true);

-- 5. 策略：匿名前端可更新自己的记录（用于回写时长）
drop policy if exists "anon update visits" on public.visits;
create policy "anon update visits"
  on public.visits for update
  to anon
  using (true)
  with check (true);

-- 6. 策略：匿名前端可读取（看板需要；如不希望公开可改为 service_role）
drop policy if exists "anon select visits" on public.visits;
create policy "anon select visits"
  on public.visits for select
  to anon
  using (true);

-- ============================================================
-- 7. 汇总视图（看板可直接查，也可导出）
-- ============================================================
create or replace view public.v_daily as
select
  date_trunc('day', entered_at at time zone 'Asia/Shanghai')::date as day,
  count(*)                                as pv,
  count(distinct visitor_id)              as uv,
  count(distinct ip)                      as ips,
  round(avg(duration))                    as avg_duration,
  sum(case when did_draw then 1 else 0 end) as draws
from public.visits
group by 1
order by 1 desc;

create or replace view public.v_ip as
select
  ip,
  count(*)                     as visits,
  count(distinct visitor_id)   as visitors,
  round(avg(duration))         as avg_duration,
  min(entered_at)              as first_seen,
  max(entered_at)              as last_seen
from public.visits
group by ip
order by visits desc;
