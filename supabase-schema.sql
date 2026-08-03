-- ============================================================
-- TankAssist — public schema (GENERATED FROM THE LIVE DATABASE)
-- Generated: 2026-08-04  ·  via Supabase MCP  ·  project ldgunrxceogfrohjrlxz
--
-- ⚠️  REFERENCE SNAPSHOT — REGENERATE VIA MCP; DO NOT HAND-EDIT.
--     Make schema changes as migrations against the live DB, then
--     regenerate this file so it keeps matching production exactly.
--
-- Covers: tables, columns, constraints, indexes, functions/RPCs, triggers,
-- the monthly_ta_summary view, RLS + all policies, API-role GRANTs, storage
-- buckets + their policies, and the Realtime publication.
--
-- Notes:
--  • gen_random_uuid() is available (pgcrypto / core, enabled by Supabase).
--  • anon & authenticated also hold REFERENCES/TRIGGER/TRUNCATE on every
--    table via Supabase's project-wide default privileges — not reachable
--    through PostgREST and omitted here for clarity.
--  • The live role model is exactly ('rep','sales_manager','management').
--    RLS is keyed off get_my_role(), which returns NULL for a deactivated
--    user, so every role-keyed policy fails closed on soft-ban.
--  • Policies written without an explicit `to` clause apply `to public`;
--    that is how they exist live and is reproduced faithfully below.
--
-- Regenerated after 12 migrations that postdate the previous (2026-07-18)
-- snapshot: add_users_is_tester, create_switch_tester_role,
-- products_ops_columns_and_oos, create_location_requests,
-- excise_company_facilities, excise_permits_table,
-- excise_allocations_and_ledger, excise_approve_reject_rpcs,
-- excise_permits_storage_bucket, guard_facility_license_change,
-- excise_dup_guard_validity_multiline, approve_excise_permit_multiline_guards.
-- ============================================================


-- ============================================================
-- 1. TABLES
-- ============================================================

create table public.users (
  id uuid primary key references auth.users(id),
  name text not null,
  email text,
  role text not null check (role = any (array['rep'::text, 'sales_manager'::text, 'management'::text])),
  phone text,
  assigned_manager_id uuid references public.users(id),
  is_active boolean not null default true,
  -- ⚠️ TEMPORARY: gates switch_tester_role(). MUST be dropped before
  -- production — see HANDOFF.md. Standing self-elevation path to management.
  is_tester boolean not null default false
);

create table public.stores (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text,
  latitude double precision,
  longitude double precision,
  contact_person text,          -- shown in-app as "Store Manager Name"
  contact_number text,
  created_by_user_id uuid references auth.users(id),
  license_number text,
  state text,
  owner_name text
);

create table public.store_assignments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id),
  store_id uuid references public.stores(id),
  assigned_date date not null default CURRENT_DATE
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
  total_market_time_minutes integer,
  address text
);

create table public.store_visits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id),
  store_id uuid references public.stores(id),
  check_in_time timestamptz,
  check_out_time timestamptz,
  duration_minutes integer,
  -- LEGACY: no longer written by the app. Reads route through the
  -- ORDERS_CUTOVER_DATE hybrid in lib/reportSemantics.ts.
  cases_sold integer default 0,
  notes text,
  photo_url text,
  latitude double precision,
  longitude double precision,
  address text,
  distance_from_store_meters double precision
);

create table public.daily_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id),
  report_date date not null default CURRENT_DATE,
  notes text,
  challenges text
);

create table public.store_visit_photos (
  id uuid primary key default gen_random_uuid(),
  visit_id uuid not null references public.store_visits(id) on delete cascade,
  user_id uuid not null references public.users(id),
  storage_path text not null,
  position integer not null default 0,
  created_at timestamptz not null default now()
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  unit text not null,                       -- legacy free-text display label
  qty_per_carton integer not null check (qty_per_carton > 0),
  product_code text,
  price_per_case numeric,
  price_per_bottle numeric,
  is_active boolean not null default true,  -- archive-only; never deleted
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  -- Ops expansion. is_out_of_stock is enforced by trg_reject_oos_order_item.
  is_out_of_stock boolean not null default false,
  brand text,
  category text,
  unit_type text,
  -- unit_size + unit_of_measure are the pair the excise BL->bottles math
  -- needs; `unit` above is free text and unusable for arithmetic.
  unit_size numeric,
  unit_of_measure text,
  gst_percent numeric,
  shelf_life_months integer,
  sku text,
  barcode text,
  hsn_code text,
  image_path text
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id),
  placed_by uuid not null references public.users(id),
  visit_id uuid references public.store_visits(id),
  status text not null default 'placed'
    check (status = any (array['placed'::text, 'in_process'::text, 'dispatched'::text,
                               'in_transit'::text, 'delivered'::text, 'cancelled'::text])),
  order_notes text,
  cancellation_reason text,
  delivered_photo_paths text[],
  delivered_verified_by uuid references public.users(id),
  created_at timestamptz not null default now()
);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid not null references public.products(id),
  cases integer not null default 0 check (cases >= 0),
  bottles integer not null default 0 check (bottles >= 0),
  free_cases integer not null default 0 check (free_cases >= 0),
  free_bottles integer not null default 0 check (free_bottles >= 0),
  -- price snapshot taken at placement; products may be repriced later
  price_per_case numeric,
  price_per_bottle numeric,
  created_at timestamptz not null default now(),
  check ((cases > 0) or (bottles > 0) or (free_cases > 0) or (free_bottles > 0))
);

create table public.order_status_history (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  from_status text,
  to_status text not null,
  changed_by uuid not null references public.users(id),
  reason text,
  changed_at timestamptz not null default now()
);

create table public.store_stock_snapshots (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id),
  product_id uuid not null references public.products(id),
  visit_id uuid references public.store_visits(id),
  cases integer not null check (cases >= 0),
  bottles integer not null check (bottles >= 0),
  recorded_by uuid not null references public.users(id),
  recorded_at timestamptz not null default now()
);

-- On-demand live location. The ONLY table in the Realtime publication.
create table public.location_requests (
  id uuid primary key default gen_random_uuid(),
  rep_id uuid not null references public.users(id),
  requested_by uuid not null references public.users(id),
  requested_at timestamptz not null default now(),
  lat double precision,
  lng double precision,
  responded_at timestamptz,
  status text not null default 'pending'
    check (status = any (array['pending'::text, 'completed'::text, 'expired'::text]))
);

-- ── Excise permits → inventory ledger (management-only) ─────────────────

-- Our own factories/warehouses. Anything NOT here is an external party (L1).
create table public.company_facilities (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  license_no text not null unique,
  license_type text,
  state text not null,
  facility_type text not null
    check (facility_type = any (array['factory'::text, 'warehouse'::text])),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  valid_from date,
  valid_until date
);

create table public.excise_permits (
  id uuid primary key default gen_random_uuid(),
  state text not null,
  permit_number text not null,        -- 'UNREAD' placeholder when unparseable
  license_no_source text,
  license_no_dest text,
  licensee_name_source text,
  licensee_name_dest text,
  liquor_class text,                  -- null on a multi-line permit (see quantity_lines)
  quantity_value numeric not null,    -- permit TOTAL
  quantity_type text not null
    check (quantity_type = any (array['BL'::text, 'PL'::text, 'UNKNOWN'::text])),
  permit_date date,
  permit_generated_at timestamptz,
  valid_until date,
  original_file_path text not null,   -- object in the excise-permits bucket
  extracted_json jsonb not null,      -- raw text, parser notes, missing fields (audit trail)
  parser_version text not null,
  status text not null default 'pending_review'
    check (status = any (array['pending_review'::text, 'approved'::text, 'rejected'::text])),
  movement_direction text not null default 'unclassified'
    check (movement_direction = any (array['factory_to_warehouse'::text, 'warehouse_to_l1'::text,
                                           'internal_transfer'::text, 'unclassified'::text])),
  facility_from_id uuid references public.company_facilities(id),
  facility_to_id uuid references public.company_facilities(id),
  uploaded_by uuid not null references public.users(id),
  uploaded_at timestamptz not null default now(),
  reviewed_by uuid references public.users(id),
  reviewed_at timestamptz,
  notes text,
  -- One entry per row of the permit's quantity table. NULL on rows that
  -- predate multi-line parsing; approve_excise_permit falls back to the
  -- scalar columns above for those.
  quantity_lines jsonb
);

create table public.permit_product_allocations (
  id uuid primary key default gen_random_uuid(),
  permit_id uuid not null references public.excise_permits(id) on delete cascade,
  product_id uuid not null references public.products(id),
  allocated_bl numeric not null,
  -- computed_* are NULLABLE on purpose: null means "could not be computed"
  -- (PL quantity, unknown unit, or missing product unit_size/unit_of_measure).
  -- Never a guess. approve_excise_permit refuses to approve while null.
  computed_bottles numeric,
  computed_cases integer,
  remainder_bottles numeric,
  needs_review boolean not null default false,
  conversion_formula_version text not null,
  line_index integer not null default 0   -- which quantity_lines entry this covers
);

-- Append-only ledger. NOTE the policy section: SELECT only, no write policy
-- for anyone. approve_excise_permit (SECURITY DEFINER) is the sole writer.
create table public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id),
  direction text not null
    check (direction = any (array['factory_to_warehouse'::text, 'warehouse_to_l1'::text,
                                  'internal_transfer'::text])),
  facility_from_id uuid references public.company_facilities(id),
  facility_to_id uuid references public.company_facilities(id),
  cases integer not null,
  remainder_bottles numeric not null,
  source_permit_id uuid references public.excise_permits(id),
  movement_date date not null,
  created_at timestamptz not null default now()
);


-- ============================================================
-- 2. INDEXES (non-constraint)
-- ============================================================

create index order_items_order_id_idx on public.order_items using btree (order_id);
create index order_status_history_order_id_idx on public.order_status_history using btree (order_id);
create index orders_store_id_status_idx on public.orders using btree (store_id, status);
create index store_stock_snapshots_store_id_product_id_recorded_at_idx
  on public.store_stock_snapshots using btree (store_id, product_id, recorded_at desc);
create index store_visit_photos_visit_id_idx on public.store_visit_photos using btree (visit_id);

create index location_requests_rep_id_idx on public.location_requests using btree (rep_id);
create index location_requests_requested_by_idx on public.location_requests using btree (requested_by);

-- The same permit can never enter the ledger twice — enforced by the DB, not
-- by a check-then-insert race in the Edge Function.
create unique index excise_permits_one_approved_per_number
  on public.excise_permits using btree (permit_number) where (status = 'approved'::text);
create index excise_permits_status_idx on public.excise_permits using btree (status);
create index excise_permits_uploaded_at_idx on public.excise_permits using btree (uploaded_at desc);
create index permit_product_allocations_permit_id_idx
  on public.permit_product_allocations using btree (permit_id);
create index inventory_movements_movement_date_idx
  on public.inventory_movements using btree (movement_date);
create index inventory_movements_product_id_direction_idx
  on public.inventory_movements using btree (product_id, direction);


-- ============================================================
-- 3. FUNCTIONS / RPCs
-- All are SECURITY DEFINER with search_path = '' (schema-qualified inside).
-- ============================================================

-- Caller's role, or NULL when deactivated / no profile (drives every policy).
create or replace function public.get_my_role()
 returns text language sql stable security definer set search_path to ''
as $function$
  select role from public.users where id = auth.uid() and is_active;
$function$;

create or replace function public.get_sales_managers()
 returns table(id uuid, name text) language sql stable security definer set search_path to ''
as $function$
  select id, name from public.users
  where role = 'sales_manager' and is_active order by name;
$function$;

-- Pre-OTP login gate: is this phone an active account? Boolean only.
create or replace function public.phone_registered(p_phone text)
 returns boolean language sql stable security definer set search_path to ''
as $function$
  select exists (select 1 from public.users where phone = p_phone and is_active);
$function$;

-- ⚠️ TEMPORARY — MUST BE DROPPED BEFORE PRODUCTION (see HANDOFF.md).
-- Self-only, role-only. Never touches is_active. Gated on is_tester.
create or replace function public.switch_tester_role(new_role text)
 returns void language plpgsql security definer set search_path to ''
as $function$
declare
  v_uid       uuid := auth.uid();
  v_is_tester boolean;
  v_is_active boolean;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select is_tester, is_active
    into v_is_tester, v_is_active
    from public.users
   where id = v_uid;

  if not found or v_is_tester is not true or v_is_active is not true then
    raise exception 'Not permitted';
  end if;

  if new_role is null or new_role not in ('rep','sales_manager','management') then
    raise exception 'Invalid role: %', coalesce(new_role, 'null');
  end if;

  update public.users
     set role = new_role
   where id = v_uid;
end;
$function$;

-- Order status machine (the ONLY legal mutator of orders.status). Enforces the
-- role matrix + strict sequential advance atomically under FOR UPDATE, and
-- writes an order_status_history row per transition.
create or replace function public.update_order_status(
    p_order_id uuid,
    p_new_status text,
    p_reason text default null::text,
    p_delivered_photo_paths text[] default null::text[])
 returns void language plpgsql security definer set search_path to ''
as $function$
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
        set status='delivered', delivered_verified_by=v_uid,
            delivered_photo_paths=p_delivered_photo_paths
        where id=p_order_id;
    elsif v_role in ('sales_manager','management') then
      if v_current <> 'in_transit' then
        raise exception 'A manager can only mark delivered from in transit'; end if;
      if p_reason is null or length(trim(p_reason)) = 0 then
        raise exception 'A reason is required for a manager delivered-override'; end if;
      update public.orders
        set status='delivered', delivered_verified_by=v_uid,
            delivered_photo_paths=p_delivered_photo_paths
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
end;
$function$;

-- The ONLY path into inventory_movements. Every guard below is deliberate;
-- an unclassified, unidentified, or unbalanced permit must not reach the ledger.
create or replace function public.approve_excise_permit(p_permit_id uuid)
 returns void language plpgsql security definer set search_path to ''
as $function$
declare
  v_permit public.excise_permits;
  v_count int; v_flagged int;
  v_lines jsonb; v_line jsonb; v_idx int; v_sum numeric; v_expected numeric;
begin
  if public.get_my_role() <> 'management' then raise exception 'Not permitted'; end if;

  select * into v_permit from public.excise_permits where id = p_permit_id for update;
  if not found then raise exception 'Permit not found'; end if;
  if v_permit.status <> 'pending_review' then raise exception 'Permit is already %', v_permit.status; end if;
  if v_permit.movement_direction = 'unclassified' then
    raise exception 'Resolve the movement direction before approving';
  end if;

  -- An unidentified permit must never enter the ledger. This also keeps the
  -- one-approved-per-number index meaningful for unreadable uploads, which all
  -- carry the same 'UNREAD' placeholder until a human sets the real number.
  if coalesce(btrim(v_permit.permit_number), '') in ('', 'UNREAD') then
    raise exception 'Set the real permit number before approving';
  end if;

  select count(*), count(*) filter (where needs_review)
    into v_count, v_flagged
    from public.permit_product_allocations where permit_id = p_permit_id;

  if v_count = 0 then raise exception 'Add at least one product allocation before approving'; end if;
  if v_flagged > 0 then raise exception 'Resolve flagged allocations before approving'; end if;
  if exists (select 1 from public.permit_product_allocations
             where permit_id = p_permit_id and (computed_cases is null or remainder_bottles is null)) then
    raise exception 'Allocations are missing computed case counts';
  end if;

  -- Per-line allocation check. Falls back to the scalar columns for any row that
  -- predates quantity_lines, so old permits behave exactly as before.
  v_lines := coalesce(v_permit.quantity_lines, jsonb_build_array(jsonb_build_object(
      'liquor_class',   v_permit.liquor_class,
      'quantity_value', v_permit.quantity_value,
      'quantity_type',  v_permit.quantity_type)));

  if exists (select 1 from public.permit_product_allocations
             where permit_id = p_permit_id
               and (line_index < 0 or line_index >= jsonb_array_length(v_lines))) then
    raise exception 'An allocation references a quantity line that does not exist';
  end if;

  for v_idx in 0 .. jsonb_array_length(v_lines) - 1 loop
    v_line := v_lines -> v_idx;
    v_expected := (v_line ->> 'quantity_value')::numeric;
    select coalesce(sum(allocated_bl), 0) into v_sum
      from public.permit_product_allocations
     where permit_id = p_permit_id and line_index = v_idx;
    if abs(v_sum - v_expected) > 0.01 then
      raise exception 'Line % allocations (%) must sum to that line''s quantity (%)',
        v_idx + 1, v_sum, v_expected;
    end if;
  end loop;

  insert into public.inventory_movements
    (product_id, direction, facility_from_id, facility_to_id, cases, remainder_bottles, source_permit_id, movement_date)
  select a.product_id, v_permit.movement_direction, v_permit.facility_from_id, v_permit.facility_to_id,
         a.computed_cases, a.remainder_bottles, v_permit.id,
         coalesce(v_permit.permit_generated_at::date, v_permit.permit_date, v_permit.uploaded_at::date)
    from public.permit_product_allocations a where a.permit_id = p_permit_id;

  update public.excise_permits
     set status='approved', reviewed_by = auth.uid(), reviewed_at = now()
   where id = p_permit_id;
end;
$function$;

create or replace function public.reject_excise_permit(p_permit_id uuid, p_reason text)
 returns void language plpgsql security definer set search_path to ''
as $function$
begin
  if public.get_my_role() <> 'management' then raise exception 'Not permitted'; end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'A reason is required'; end if;
  update public.excise_permits
     set status='rejected', reviewed_by = auth.uid(), reviewed_at = now(),
         notes = coalesce(notes || E'\n', '') || 'Rejected: ' || p_reason
   where id = p_permit_id and status = 'pending_review';
  if not found then raise exception 'Permit not found or already reviewed'; end if;
end;
$function$;

-- ── Trigger functions ───────────────────────────────────────────────────

-- Out-of-stock is enforced in the DB, not just the picker: a stale client
-- cannot place an OOS line.
create or replace function public.reject_out_of_stock_order_item()
 returns trigger language plpgsql security definer set search_path to ''
as $function$
begin
  if exists (
    select 1 from public.products p
    where p.id = new.product_id and p.is_out_of_stock = true
  ) then
    raise exception 'Product is out of stock';
  end if;
  return new;
end;
$function$;

-- A licence number is historical evidence once anything references it.
create or replace function public.guard_facility_license_change()
 returns trigger language plpgsql security definer set search_path to ''
as $function$
begin
  -- Typo fixes are fine while nothing references the facility. Once permits or
  -- ledger rows point at it, the licence number is historical evidence: retire
  -- the facility (is_active = false) and add a new row instead of rewriting it.
  if new.license_no is distinct from old.license_no then
    if exists (select 1 from public.excise_permits p
                where p.facility_from_id = old.id or p.facility_to_id = old.id)
       or exists (select 1 from public.inventory_movements m
                where m.facility_from_id = old.id or m.facility_to_id = old.id) then
      raise exception 'Licence number is locked: permits already reference this facility. Set it inactive and add a new facility instead.';
    end if;
  end if;
  return new;
end;
$function$;


-- ============================================================
-- 4. TRIGGERS
-- ============================================================

create trigger trg_reject_oos_order_item
  before insert on public.order_items
  for each row execute function public.reject_out_of_stock_order_item();

create trigger trg_guard_facility_license
  before update on public.company_facilities
  for each row execute function public.guard_facility_license_change();


-- ============================================================
-- 5. VIEW
-- Still visit-based for market time / distance / stores. total_cases_sold is
-- LEGACY and is no longer used for cases anywhere (see lib/reportSemantics.ts).
-- ============================================================

create view public.monthly_ta_summary
with (security_invoker = on) as
 with att as (
     select attendance.user_id,
        date_trunc('month'::text, (attendance.check_in_time at time zone 'UTC'::text))::date as month,
        count(distinct (attendance.check_in_time at time zone 'UTC'::text)::date) as days_present,
        coalesce(sum(attendance.total_market_time_minutes), 0::bigint) as total_market_time_minutes,
        coalesce(sum(attendance.total_distance_km), 0::double precision) as total_distance_km
       from attendance
      where attendance.check_in_time is not null
      group by attendance.user_id, (date_trunc('month'::text, (attendance.check_in_time at time zone 'UTC'::text)))
    ), vis as (
     select store_visits.user_id,
        date_trunc('month'::text, (store_visits.check_in_time at time zone 'UTC'::text))::date as month,
        count(*) filter (where store_visits.check_out_time is not null) as stores_visited,
        coalesce(sum(store_visits.cases_sold), 0::bigint) as total_cases_sold
       from store_visits
      where store_visits.check_in_time is not null
      group by store_visits.user_id, (date_trunc('month'::text, (store_visits.check_in_time at time zone 'UTC'::text)))
    ), keys as (
     select att.user_id, att.month from att
   union
     select vis.user_id, vis.month from vis
    )
 select k.user_id,
    u.name as rep_name,
    k.month,
    to_char(k.month::timestamptz, 'YYYY-MM'::text) as month_label,
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
-- 6. ROW LEVEL SECURITY
-- ============================================================

alter table public.users                      enable row level security;
alter table public.stores                     enable row level security;
alter table public.store_assignments          enable row level security;
alter table public.attendance                 enable row level security;
alter table public.store_visits               enable row level security;
alter table public.daily_reports              enable row level security;
alter table public.store_visit_photos         enable row level security;
alter table public.products                   enable row level security;
alter table public.orders                     enable row level security;
alter table public.order_items                enable row level security;
alter table public.order_status_history       enable row level security;
alter table public.store_stock_snapshots      enable row level security;
alter table public.location_requests          enable row level security;
alter table public.company_facilities         enable row level security;
alter table public.excise_permits             enable row level security;
alter table public.permit_product_allocations enable row level security;
alter table public.inventory_movements        enable row level security;

-- ── users ──────────────────────────────────────────────────────────────
-- Self-read survives deactivation so the app can show "account deactivated".
create policy "Users: read own"      on public.users for select using (auth.uid() = id);
create policy "Users: admin read all" on public.users for select
  using (get_my_role() = any (array['sales_manager'::text, 'management'::text]));
create policy "Users: management insert" on public.users for insert
  with check (get_my_role() = 'management'::text);
create policy "Users: management update" on public.users for update
  using (get_my_role() = 'management'::text) with check (get_my_role() = 'management'::text);
-- Self-update with the role pinned, so a user cannot elevate themselves.
create policy "Users: self update (role locked)" on public.users for update
  using (auth.uid() = id) with check ((auth.uid() = id) and (role = get_my_role()));

-- ── stores ─────────────────────────────────────────────────────────────
create policy "Stores: authenticated read" on public.stores for select
  using (get_my_role() is not null);
create policy "Stores: authenticated insert" on public.stores for insert to authenticated
  with check ((created_by_user_id = auth.uid()) and (get_my_role() is not null));
create policy "Stores: manager update" on public.stores for update
  using (get_my_role() = any (array['sales_manager'::text, 'management'::text]));
create policy "Stores: manager delete" on public.stores for delete
  using (get_my_role() = any (array['sales_manager'::text, 'management'::text]));

-- ── store_assignments ──────────────────────────────────────────────────
create policy "Assignments: authenticated read" on public.store_assignments for select
  using (get_my_role() is not null);
create policy "Assignments: manager insert" on public.store_assignments for insert
  with check (get_my_role() = any (array['sales_manager'::text, 'management'::text]));
create policy "Assignments: manager update" on public.store_assignments for update
  using (get_my_role() = any (array['sales_manager'::text, 'management'::text]));
create policy "Assignments: manager delete" on public.store_assignments for delete
  using (get_my_role() = any (array['sales_manager'::text, 'management'::text]));

-- ── attendance ─────────────────────────────────────────────────────────
create policy "Attendance: read own" on public.attendance for select using (auth.uid() = user_id);
create policy "Attendance: manager read all" on public.attendance for select
  using (get_my_role() = any (array['sales_manager'::text, 'management'::text]));
create policy "Attendance: insert own" on public.attendance for insert
  with check ((auth.uid() = user_id) and (get_my_role() is not null));
create policy "Attendance: update own" on public.attendance for update
  using ((auth.uid() = user_id) and (get_my_role() is not null));

-- ── store_visits ───────────────────────────────────────────────────────
create policy "Visits: read own" on public.store_visits for select using (auth.uid() = user_id);
create policy "Visits: manager read all" on public.store_visits for select
  using (get_my_role() = any (array['sales_manager'::text, 'management'::text]));
create policy "Visits: insert own" on public.store_visits for insert
  with check ((auth.uid() = user_id) and (get_my_role() is not null));
create policy "Visits: update own" on public.store_visits for update
  using ((auth.uid() = user_id) and (get_my_role() is not null));

-- ── daily_reports ──────────────────────────────────────────────────────
create policy "Reports: read own" on public.daily_reports for select using (auth.uid() = user_id);
create policy "Reports: manager read all" on public.daily_reports for select
  using (get_my_role() = any (array['sales_manager'::text, 'management'::text]));
create policy "Reports: insert own" on public.daily_reports for insert
  with check ((auth.uid() = user_id) and (get_my_role() is not null));

-- ── store_visit_photos ─────────────────────────────────────────────────
create policy "VisitPhotos: read own" on public.store_visit_photos for select
  using (auth.uid() = user_id);
create policy "VisitPhotos: manager read all" on public.store_visit_photos for select
  using (get_my_role() = any (array['sales_manager'::text, 'management'::text]));
create policy "VisitPhotos: insert own" on public.store_visit_photos for insert
  with check ((auth.uid() = user_id) and (get_my_role() is not null));
create policy "VisitPhotos: update own" on public.store_visit_photos for update
  using ((auth.uid() = user_id) and (get_my_role() is not null))
  with check ((auth.uid() = user_id) and (get_my_role() is not null));
create policy "VisitPhotos: delete own" on public.store_visit_photos for delete
  using ((auth.uid() = user_id) and (get_my_role() is not null));

-- ── products ── archive-only: NO delete policy and no delete grant ──────
create policy "Products: authenticated read" on public.products for select
  using (get_my_role() is not null);
create policy "Products: management insert" on public.products for insert
  with check (get_my_role() = 'management'::text);
create policy "Products: management update" on public.products for update
  using (get_my_role() = 'management'::text) with check (get_my_role() = 'management'::text);

-- ── orders ── NO update policy: update_order_status() is the only mutator ─
create policy "Orders: authenticated read" on public.orders for select
  using (get_my_role() is not null);
create policy "Orders: insert own" on public.orders for insert
  with check ((placed_by = auth.uid()) and (get_my_role() is not null));

-- ── order_items ────────────────────────────────────────────────────────
create policy "OrderItems: authenticated read" on public.order_items for select
  using (get_my_role() is not null);
create policy "OrderItems: insert own order" on public.order_items for insert
  with check ((get_my_role() is not null) and (exists (
    select 1 from orders o where ((o.id = order_items.order_id) and (o.placed_by = auth.uid())))));

-- ── order_status_history ── read-only; written by the RPC ──────────────
create policy "History: authenticated read" on public.order_status_history for select
  using (get_my_role() is not null);

-- ── store_stock_snapshots ── append-only ───────────────────────────────
create policy "Snapshots: authenticated read" on public.store_stock_snapshots for select
  using (get_my_role() is not null);
create policy "Snapshots: insert own" on public.store_stock_snapshots for insert
  with check ((recorded_by = auth.uid()) and (get_my_role() is not null));

-- ── location_requests ──────────────────────────────────────────────────
-- Split reads: the rep being asked, and the manager who asked.
create policy "LocReq: rep read targeted" on public.location_requests for select to authenticated
  using (rep_id = auth.uid());
create policy "LocReq: requester read own" on public.location_requests for select to authenticated
  using (requested_by = auth.uid());
-- Insert requires an ACTIVE REP the requester actually owns: management may
-- ask anyone; a sales_manager only their own reports.
create policy "LocReq: requester insert" on public.location_requests for insert to authenticated
  with check ((requested_by = auth.uid()) and (status = 'pending'::text) and (exists (
    select 1 from users u
    where ((u.id = location_requests.rep_id) and (u.role = 'rep'::text) and (u.is_active = true)
      and ((get_my_role() = 'management'::text)
        or ((get_my_role() = 'sales_manager'::text) and (u.assigned_manager_id = auth.uid())))))));
create policy "LocReq: rep responds" on public.location_requests for update to authenticated
  using ((rep_id = auth.uid()) and (get_my_role() is not null))
  with check (rep_id = auth.uid());

-- ── company_facilities ─────────────────────────────────────────────────
create policy "Facilities: authenticated read" on public.company_facilities for select to authenticated
  using (get_my_role() is not null);
create policy "Facilities: management insert" on public.company_facilities for insert to authenticated
  with check (get_my_role() = 'management'::text);
create policy "Facilities: management update" on public.company_facilities for update to authenticated
  using (get_my_role() = 'management'::text) with check (get_my_role() = 'management'::text);

-- ── excise_permits ── management-only; edits confined to pending_review ─
create policy "Permits: management read" on public.excise_permits for select to authenticated
  using (get_my_role() = 'management'::text);
create policy "Permits: management upload" on public.excise_permits for insert to authenticated
  with check ((get_my_role() = 'management'::text) and (uploaded_by = auth.uid())
              and (status = 'pending_review'::text));
create policy "Permits: management edit pending" on public.excise_permits for update to authenticated
  using ((get_my_role() = 'management'::text) and (status = 'pending_review'::text))
  with check (get_my_role() = 'management'::text);

-- ── permit_product_allocations ── writable only while the permit is pending ─
create policy "Allocations: management read" on public.permit_product_allocations for select to authenticated
  using (get_my_role() = 'management'::text);
create policy "Allocations: management insert" on public.permit_product_allocations for insert to authenticated
  with check ((get_my_role() = 'management'::text) and (exists (
    select 1 from excise_permits p
    where ((p.id = permit_product_allocations.permit_id) and (p.status = 'pending_review'::text)))));
create policy "Allocations: management update" on public.permit_product_allocations for update to authenticated
  using ((get_my_role() = 'management'::text) and (exists (
    select 1 from excise_permits p
    where ((p.id = permit_product_allocations.permit_id) and (p.status = 'pending_review'::text)))))
  with check (get_my_role() = 'management'::text);
create policy "Allocations: management delete" on public.permit_product_allocations for delete to authenticated
  using ((get_my_role() = 'management'::text) and (exists (
    select 1 from excise_permits p
    where ((p.id = permit_product_allocations.permit_id) and (p.status = 'pending_review'::text)))));

-- ── inventory_movements ────────────────────────────────────────────────
-- SELECT ONLY. There is deliberately NO insert/update/delete policy for any
-- role: approve_excise_permit() writes it as the table owner. Same shape as
-- orders.status — the ledger has exactly one legal writer.
create policy "Movements: management read" on public.inventory_movements for select to authenticated
  using (get_my_role() = 'management'::text);


-- ============================================================
-- 7. GRANTS (API roles)
-- RLS is the security boundary; grants are the coarse gate in front of it.
-- Note the deliberate omissions: no DELETE on products (archive-only), no
-- UPDATE on orders (RPC-only), no write at all on order_status_history or
-- inventory_movements.
-- ============================================================

grant select, insert, update         on public.users                      to authenticated;
grant select                         on public.users                      to anon;  -- legacy; RLS still applies
grant select, insert, update         on public.stores                     to authenticated;
grant select, insert, update         on public.store_assignments          to authenticated;
grant select, insert, update         on public.attendance                 to authenticated;
grant select, insert, update         on public.store_visits               to authenticated;
grant select, insert, update         on public.daily_reports              to authenticated;
grant select, insert, update, delete on public.store_visit_photos         to authenticated;
grant select, insert, update         on public.products                   to authenticated;
grant select, insert                 on public.orders                     to authenticated;
grant select, insert                 on public.order_items                to authenticated;
grant select                         on public.order_status_history       to authenticated;
grant select, insert                 on public.store_stock_snapshots      to authenticated;
grant select, insert                 on public.location_requests          to authenticated;
grant select, insert, update         on public.company_facilities         to authenticated;
grant select, insert, update         on public.excise_permits             to authenticated;
grant select, insert, update, delete on public.permit_product_allocations to authenticated;
grant select                         on public.inventory_movements        to authenticated;
grant select                         on public.monthly_ta_summary         to authenticated;

-- Function EXECUTE (live state). anon holds EXECUTE only on phone_registered,
-- the pre-OTP login gate, which returns a boolean and nothing else.
revoke execute on function public.get_my_role()                     from anon, public;
revoke execute on function public.get_sales_managers()              from anon, public;
revoke execute on function public.update_order_status(uuid, text, text, text[]) from anon, public;
revoke execute on function public.switch_tester_role(text)          from anon, public;
revoke execute on function public.approve_excise_permit(uuid)       from anon, public;
revoke execute on function public.reject_excise_permit(uuid, text)  from anon, public;

grant execute on function public.get_my_role()                      to authenticated, service_role;
grant execute on function public.get_sales_managers()               to authenticated;
grant execute on function public.phone_registered(text)             to anon, authenticated;
grant execute on function public.update_order_status(uuid, text, text, text[]) to authenticated;
grant execute on function public.switch_tester_role(text)           to authenticated;
grant execute on function public.approve_excise_permit(uuid)        to authenticated;
grant execute on function public.reject_excise_permit(uuid, text)   to authenticated;


-- ============================================================
-- 8. STORAGE (buckets + policies) — reference, managed via the storage API
-- ============================================================
--
-- visit-photos    private, no size/mime limit.
--   Paths: selfies/… · store-photos/… · stock-photos/… · delivered-photos/…
--   Policies are bucket-scoped to any authenticated user (no role gate):
--     SELECT / INSERT / UPDATE / DELETE  using (bucket_id = 'visit-photos')
--
-- excise-permits  private, file_size_limit 10485760 (10 MB),
--   allowed_mime_types = {application/pdf, image/jpeg, image/png}
--   Policies (management-gated), SELECT + INSERT ONLY:
--     "Permits bucket: management read"
--       using ((bucket_id = 'excise-permits') and (get_my_role() = 'management'))
--     "Permits bucket: management upload"
--       with check ((bucket_id = 'excise-permits') and (get_my_role() = 'management'))
--
--   ⚠️ There is deliberately NO UPDATE and NO DELETE policy on excise-permits.
--   A permit original is audit evidence and nothing in the app may alter or
--   remove one. The known consequence is that a turned-away duplicate upload
--   leaves an orphan file; that is ACCEPTED, not a bug to fix by granting
--   DELETE. See HANDOFF.md "Known defects". Orphans are clearable by a human
--   under service-role, out of band.


-- ============================================================
-- 9. REALTIME
-- ============================================================
-- Exactly one table is published. There is no background location tracking:
-- a manager INSERTs a pending request, the checked-in rep's app answers once.
--   alter publication supabase_realtime add table public.location_requests;


-- ============================================================
-- END — regenerate via MCP; do not hand-edit.
-- ============================================================
