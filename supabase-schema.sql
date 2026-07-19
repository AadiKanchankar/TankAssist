-- ============================================================
-- TankAssist — public schema (GENERATED FROM THE LIVE DATABASE)
-- Generated: 2026-07-18  ·  via Supabase MCP  ·  project ldgunrxceogfrohjrlxz
--
-- ⚠️  REFERENCE SNAPSHOT — REGENERATE VIA MCP; DO NOT HAND-EDIT.
--     Make schema changes as migrations against the live DB, then
--     regenerate this file so it keeps matching production exactly.
--
-- Covers: tables, columns, constraints, indexes, functions/RPCs, the
-- monthly_ta_summary view, RLS + all policies, and API-role GRANTs.
--
-- Notes:
--  • gen_random_uuid() is available (pgcrypto / core, enabled by Supabase).
--  • anon & authenticated also hold REFERENCES/TRIGGER/TRUNCATE on every
--    table via Supabase's project-wide default privileges — not reachable
--    through PostgREST and omitted here for clarity.
--  • Four roles existed historically; the live model is exactly
--    ('rep','sales_manager','management'). RLS is keyed off get_my_role().
-- ============================================================

-- ============================================================
-- 1. TABLES  (+ their indexes)
-- ============================================================

create table public.users (
  id uuid primary key references auth.users(id),
  name text not null,
  email text,
  role text not null check (role = any (array['rep'::text, 'sales_manager'::text, 'management'::text])),
  phone text,
  assigned_manager_id uuid references public.users(id),
  is_active boolean not null default true
);

create table public.stores (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text,
  latitude double precision,
  longitude double precision,
  contact_person text,                         -- surfaced in UI as "Store Manager Name"
  contact_number text,
  created_by_user_id uuid references auth.users(id),
  license_number text,
  state text,                                  -- auto-derived Indian state (never hand-entered)
  owner_name text
);

create table public.store_assignments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id),
  store_id uuid references public.stores(id),
  assigned_date date not null default current_date
);

create table public.attendance (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id),
  check_in_time timestamptz,
  check_out_time timestamptz,
  latitude double precision,
  longitude double precision,
  selfie_url text,
  total_distance_km double precision,
  total_market_time_minutes int,
  address text
);

create table public.store_visits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id),
  store_id uuid references public.stores(id),
  check_in_time timestamptz,
  check_out_time timestamptz,
  duration_minutes int,
  cases_sold int default 0,                    -- legacy sales figure (pre-orders-cutover; see app lib/reportSemantics.ts)
  notes text,
  photo_url text,                              -- first photo, legacy; readers fall back to store_visit_photos
  latitude double precision,
  longitude double precision,
  address text,
  distance_from_store_meters double precision
);

create table public.daily_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id),
  report_date date not null default current_date,
  notes text,
  challenges text
);

create table public.store_visit_photos (
  id uuid primary key default gen_random_uuid(),
  visit_id uuid not null references public.store_visits(id) on delete cascade,
  user_id uuid not null references public.users(id),  -- denormalized for RLS
  storage_path text not null,
  position int not null default 0,
  created_at timestamptz not null default now()
);
create index store_visit_photos_visit_id_idx on public.store_visit_photos using btree (visit_id);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  unit text not null,                          -- free text: ml / kg / pieces / …
  qty_per_carton int not null check (qty_per_carton > 0),
  product_code text,
  price_per_case numeric,
  price_per_bottle numeric,
  is_active boolean not null default true,     -- archive-only (no DELETE policy anywhere)
  created_by uuid references public.users(id),
  created_at timestamptz not null default now()
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id),
  placed_by uuid not null references public.users(id),
  visit_id uuid references public.store_visits(id),
  status text not null default 'placed'
    check (status = any (array['placed'::text, 'in_process'::text, 'dispatched'::text, 'in_transit'::text, 'delivered'::text, 'cancelled'::text])),
  order_notes text,
  cancellation_reason text,
  delivered_photo_paths text[],
  delivered_verified_by uuid references public.users(id),
  created_at timestamptz not null default now()
);
create index orders_store_id_status_idx on public.orders using btree (store_id, status);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid not null references public.products(id),
  cases int not null default 0 check (cases >= 0),
  bottles int not null default 0 check (bottles >= 0),
  free_cases int not null default 0 check (free_cases >= 0),
  free_bottles int not null default 0 check (free_bottles >= 0),
  price_per_case numeric,                      -- price snapshot at placement
  price_per_bottle numeric,
  created_at timestamptz not null default now(),
  check (cases > 0 or bottles > 0 or free_cases > 0 or free_bottles > 0)
);
create index order_items_order_id_idx on public.order_items using btree (order_id);

create table public.order_status_history (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  from_status text,
  to_status text not null,
  changed_by uuid not null references public.users(id),
  reason text,
  changed_at timestamptz not null default now()
);
create index order_status_history_order_id_idx on public.order_status_history using btree (order_id);

create table public.store_stock_snapshots (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id),
  product_id uuid not null references public.products(id),
  visit_id uuid references public.store_visits(id),
  cases int not null check (cases >= 0),
  bottles int not null check (bottles >= 0),
  recorded_by uuid not null references public.users(id),
  recorded_at timestamptz not null default now()  -- append-only; current stock = latest per store+product
);
create index store_stock_snapshots_store_id_product_id_recorded_at_idx
  on public.store_stock_snapshots using btree (store_id, product_id, recorded_at desc);

-- ============================================================
-- 2. FUNCTIONS / RPCs
-- ============================================================

-- Caller's role, or NULL when deactivated / no profile (drives every
-- role-keyed policy). STABLE SECURITY DEFINER, search_path pinned empty.
create or replace function public.get_my_role()
returns text language sql stable security definer set search_path to ''
as $$
  select role from public.users where id = auth.uid() and is_active;
$$;
revoke execute on function public.get_my_role() from public, anon;
grant execute on function public.get_my_role() to authenticated, service_role;

-- id+name of active sales managers (registration/manager pickers). No phone/email.
create or replace function public.get_sales_managers()
returns table(id uuid, name text) language sql stable security definer set search_path to ''
as $$
  select id, name from public.users where role = 'sales_manager' and is_active order by name;
$$;
revoke execute on function public.get_sales_managers() from public, anon;
grant execute on function public.get_sales_managers() to authenticated;

-- Pre-OTP login gate: is this phone an active account? Boolean only.
create or replace function public.phone_registered(p_phone text)
returns boolean language sql stable security definer set search_path to ''
as $$
  select exists (select 1 from public.users where phone = p_phone and is_active);
$$;
revoke all on function public.phone_registered(text) from public;
grant execute on function public.phone_registered(text) to anon, authenticated;

-- Order status machine (the ONLY legal mutator of orders.status). Enforces the
-- role matrix + strict sequential transitions atomically and writes history.
create or replace function public.update_order_status(
  p_order_id uuid, p_new_status text, p_reason text default null, p_delivered_photo_paths text[] default null
) returns void language plpgsql security definer set search_path to ''
as $$
declare
  v_role text; v_uid uuid; v_current text; v_placed_by uuid; v_store_id uuid;
begin
  v_uid := auth.uid();
  v_role := public.get_my_role();
  if v_role is null then raise exception 'Not authorized'; end if;

  select status, placed_by, store_id
    into v_current, v_placed_by, v_store_id
    from public.orders where id = p_order_id for update;
  if not found then raise exception 'Order not found'; end if;
  if v_current in ('delivered','cancelled') then
    raise exception 'Order is already % and cannot change', v_current; end if;

  if p_new_status = 'cancelled' then
    if p_reason is null or length(trim(p_reason)) = 0 then
      raise exception 'A cancellation reason is required'; end if;
    if v_role = 'rep' and v_placed_by <> v_uid then
      raise exception 'You can only cancel orders you placed'; end if;
    update public.orders set status='cancelled', cancellation_reason=p_reason where id=p_order_id;

  elsif p_new_status = 'delivered' then
    if v_role = 'rep' then
      if not exists (
        select 1 from public.store_visits sv
        where sv.store_id = v_store_id and sv.user_id = v_uid and sv.check_out_time is null
      ) then
        raise exception 'Open a check-in at this store before marking its order delivered'; end if;
      update public.orders
        set status='delivered', delivered_verified_by=v_uid, delivered_photo_paths=p_delivered_photo_paths
        where id=p_order_id;
    elsif v_role in ('sales_manager','management') then
      if v_current <> 'in_transit' then
        raise exception 'A manager can only mark delivered from in transit'; end if;
      if p_reason is null or length(trim(p_reason)) = 0 then
        raise exception 'A reason is required for a manager delivered-override'; end if;
      update public.orders
        set status='delivered', delivered_verified_by=v_uid, delivered_photo_paths=p_delivered_photo_paths
        where id=p_order_id;
    else
      raise exception 'Not authorized to mark delivered';
    end if;

  elsif p_new_status in ('in_process','dispatched','in_transit') then
    if v_role not in ('sales_manager','management') then
      raise exception 'Only a sales manager or management can advance an order'; end if;
    if not (
      (v_current='placed'     and p_new_status='in_process') or
      (v_current='in_process' and p_new_status='dispatched') or
      (v_current='dispatched' and p_new_status='in_transit')
    ) then raise exception 'Invalid transition from % to %', v_current, p_new_status; end if;
    update public.orders set status=p_new_status where id=p_order_id;

  else
    raise exception 'Unknown target status %', p_new_status;
  end if;

  insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
    values (p_order_id, v_current, p_new_status, v_uid, p_reason);
end; $$;
revoke all on function public.update_order_status(uuid, text, text, text[]) from public, anon;
grant execute on function public.update_order_status(uuid, text, text, text[]) to authenticated;

-- ============================================================
-- 3. VIEW  — public.monthly_ta_summary  (security_invoker; respects caller RLS)
-- ============================================================
create view public.monthly_ta_summary with (security_invoker = on) as
 with att as (
   select attendance.user_id,
     date_trunc('month', (attendance.check_in_time at time zone 'UTC'))::date as month,
     count(distinct (attendance.check_in_time at time zone 'UTC')::date) as days_present,
     coalesce(sum(attendance.total_market_time_minutes), 0::bigint) as total_market_time_minutes,
     coalesce(sum(attendance.total_distance_km), 0::double precision) as total_distance_km
   from attendance
   where attendance.check_in_time is not null
   group by attendance.user_id, (date_trunc('month', (attendance.check_in_time at time zone 'UTC')))
 ), vis as (
   select store_visits.user_id,
     date_trunc('month', (store_visits.check_in_time at time zone 'UTC'))::date as month,
     count(*) filter (where store_visits.check_out_time is not null) as stores_visited,
     coalesce(sum(store_visits.cases_sold), 0::bigint) as total_cases_sold
   from store_visits
   where store_visits.check_in_time is not null
   group by store_visits.user_id, (date_trunc('month', (store_visits.check_in_time at time zone 'UTC')))
 ), keys as (
   select att.user_id, att.month from att
   union
   select vis.user_id, vis.month from vis
 )
 select k.user_id,
   u.name as rep_name,
   k.month,
   to_char(k.month::timestamptz, 'YYYY-MM') as month_label,
   coalesce(a.days_present, 0::bigint) as days_present,
   coalesce(a.total_market_time_minutes, 0::bigint) as total_market_time_minutes,
   round(coalesce(a.total_distance_km, 0::double precision)::numeric, 2) as total_distance_km,
   coalesce(v.stores_visited, 0::bigint) as stores_visited,
   coalesce(v.total_cases_sold, 0::bigint) as total_cases_sold
 from keys k
   join users u on u.id = k.user_id
   left join att a on a.user_id = k.user_id and a.month = k.month
   left join vis v on v.user_id = k.user_id and v.month = k.month;

-- ============================================================
-- 4. ROW LEVEL SECURITY
-- ============================================================
alter table public.users enable row level security;
alter table public.stores enable row level security;
alter table public.store_assignments enable row level security;
alter table public.attendance enable row level security;
alter table public.store_visits enable row level security;
alter table public.daily_reports enable row level security;
alter table public.store_visit_photos enable row level security;
alter table public.products enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_status_history enable row level security;
alter table public.store_stock_snapshots enable row level security;

-- ---- users ----
create policy "Users: read own" on public.users
  for select using (auth.uid() = id);
create policy "Users: admin read all" on public.users
  for select using (get_my_role() = any (array['sales_manager'::text, 'management'::text]));
create policy "Users: management insert" on public.users
  for insert with check (get_my_role() = 'management');
create policy "Users: management update" on public.users
  for update using (get_my_role() = 'management') with check (get_my_role() = 'management');
create policy "Users: self update (role locked)" on public.users
  for update using (auth.uid() = id) with check ((auth.uid() = id) and (role = get_my_role()));

-- ---- stores ----
create policy "Stores: authenticated read" on public.stores
  for select using (get_my_role() is not null);
create policy "Stores: authenticated insert" on public.stores
  for insert to authenticated with check ((created_by_user_id = auth.uid()) and (get_my_role() is not null));
create policy "Stores: manager update" on public.stores
  for update using (get_my_role() = any (array['sales_manager'::text, 'management'::text]));
create policy "Stores: manager delete" on public.stores
  for delete using (get_my_role() = any (array['sales_manager'::text, 'management'::text]));

-- ---- store_assignments ----
create policy "Assignments: authenticated read" on public.store_assignments
  for select using (get_my_role() is not null);
create policy "Assignments: manager insert" on public.store_assignments
  for insert with check (get_my_role() = any (array['sales_manager'::text, 'management'::text]));
create policy "Assignments: manager update" on public.store_assignments
  for update using (get_my_role() = any (array['sales_manager'::text, 'management'::text]));
create policy "Assignments: manager delete" on public.store_assignments
  for delete using (get_my_role() = any (array['sales_manager'::text, 'management'::text]));

-- ---- attendance ----
create policy "Attendance: read own" on public.attendance
  for select using (auth.uid() = user_id);
create policy "Attendance: manager read all" on public.attendance
  for select using (get_my_role() = any (array['sales_manager'::text, 'management'::text]));
create policy "Attendance: insert own" on public.attendance
  for insert with check ((auth.uid() = user_id) and (get_my_role() is not null));
create policy "Attendance: update own" on public.attendance
  for update using ((auth.uid() = user_id) and (get_my_role() is not null));

-- ---- store_visits ----
create policy "Visits: read own" on public.store_visits
  for select using (auth.uid() = user_id);
create policy "Visits: manager read all" on public.store_visits
  for select using (get_my_role() = any (array['sales_manager'::text, 'management'::text]));
create policy "Visits: insert own" on public.store_visits
  for insert with check ((auth.uid() = user_id) and (get_my_role() is not null));
create policy "Visits: update own" on public.store_visits
  for update using ((auth.uid() = user_id) and (get_my_role() is not null));

-- ---- daily_reports ----
create policy "Reports: read own" on public.daily_reports
  for select using (auth.uid() = user_id);
create policy "Reports: manager read all" on public.daily_reports
  for select using (get_my_role() = any (array['sales_manager'::text, 'management'::text]));
create policy "Reports: insert own" on public.daily_reports
  for insert with check ((auth.uid() = user_id) and (get_my_role() is not null));

-- ---- store_visit_photos ----
create policy "VisitPhotos: read own" on public.store_visit_photos
  for select using (auth.uid() = user_id);
create policy "VisitPhotos: manager read all" on public.store_visit_photos
  for select using (get_my_role() = any (array['sales_manager'::text, 'management'::text]));
create policy "VisitPhotos: insert own" on public.store_visit_photos
  for insert with check ((auth.uid() = user_id) and (get_my_role() is not null));
create policy "VisitPhotos: update own" on public.store_visit_photos
  for update using ((auth.uid() = user_id) and (get_my_role() is not null))
  with check ((auth.uid() = user_id) and (get_my_role() is not null));
create policy "VisitPhotos: delete own" on public.store_visit_photos
  for delete using ((auth.uid() = user_id) and (get_my_role() is not null));

-- ---- products ----  (management-only writes; NO delete policy → archive only)
create policy "Products: authenticated read" on public.products
  for select using (get_my_role() is not null);
create policy "Products: management insert" on public.products
  for insert with check (get_my_role() = 'management');
create policy "Products: management update" on public.products
  for update using (get_my_role() = 'management') with check (get_my_role() = 'management');

-- ---- orders ----  (NO update/delete policy → status changes only via RPC)
create policy "Orders: authenticated read" on public.orders
  for select using (get_my_role() is not null);
create policy "Orders: insert own" on public.orders
  for insert with check ((placed_by = auth.uid()) and (get_my_role() is not null));

-- ---- order_items ----
create policy "OrderItems: authenticated read" on public.order_items
  for select using (get_my_role() is not null);
create policy "OrderItems: insert own order" on public.order_items
  for insert with check (
    (get_my_role() is not null)
    and (exists (select 1 from public.orders o where ((o.id = order_items.order_id) and (o.placed_by = auth.uid()))))
  );

-- ---- order_status_history ----  (read-only to API; written only by the RPC)
create policy "History: authenticated read" on public.order_status_history
  for select using (get_my_role() is not null);

-- ---- store_stock_snapshots ----  (append-only)
create policy "Snapshots: authenticated read" on public.store_stock_snapshots
  for select using (get_my_role() is not null);
create policy "Snapshots: insert own" on public.store_stock_snapshots
  for insert with check ((recorded_by = auth.uid()) and (get_my_role() is not null));

-- ============================================================
-- 5. API-ROLE TABLE GRANTS  (RLS still applies on top of these)
-- ============================================================
grant select, insert, update on public.users to authenticated;
grant select on public.users to anon;                 -- vestigial (RLS denies anon rows); harmless
grant select, insert, update on public.stores to authenticated;
grant select, insert, update on public.store_assignments to authenticated;
grant select, insert, update on public.attendance to authenticated;
grant select, insert, update on public.store_visits to authenticated;
grant select, insert, update on public.daily_reports to authenticated;
grant delete, insert, select, update on public.store_visit_photos to authenticated;
grant select, insert, update on public.products to authenticated;
grant select, insert on public.orders to authenticated;             -- NO update/delete (RPC-only mutations)
grant select, insert on public.order_items to authenticated;
grant select on public.order_status_history to authenticated;       -- read-only (RPC writes)
grant select, insert on public.store_stock_snapshots to authenticated;
grant select on public.monthly_ta_summary to authenticated;

-- ============================================================
-- END — regenerate via MCP; do not hand-edit.
-- ============================================================
