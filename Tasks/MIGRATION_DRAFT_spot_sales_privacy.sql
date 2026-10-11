-- ════════════════════════════════════════════════════════════════════════════
-- Migration: spot_sales_privacy  (batch TANKASSIST_SPOTSALE_PRIVACY, §1d §3 §4 §5 §6)
-- STOP-POINT draft — not applied.
-- ════════════════════════════════════════════════════════════════════════════

-- ── §1d  competitor_brands: seeded, management-editable lookup ──────────────
create table public.competitor_brands (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique check (char_length(btrim(name)) between 1 and 60),
  sort_order  int  not null default 100,
  is_active   boolean not null default true,   -- archive, never delete (history references it)
  created_at  timestamptz not null default now()
);
insert into public.competitor_brands (name, sort_order) values
  ('Kingfisher', 10), ('Tuborg', 20), ('Budweiser', 30), ('Carlsberg', 40),
  ('Heineken', 50), ('Bira 91', 60), ('Simba', 70), ('Haywards 5000', 80),
  ('Godfather', 90), ('Nothing specific', 900), ('Other', 999);
alter table public.competitor_brands enable row level security;
create policy "Brands: read" on public.competitor_brands for select to authenticated
  using (public.get_my_role() is not null);
create policy "Brands: management insert" on public.competitor_brands for insert to authenticated
  with check (public.get_my_role() = 'management');
create policy "Brands: management update" on public.competitor_brands for update to authenticated
  using (public.get_my_role() = 'management') with check (public.get_my_role() = 'management');
grant select, insert, update on public.competitor_brands to authenticated;

-- ── §1d  spot_sales: one row per customer interaction, append-only ──────────
create table public.spot_sales (
  id                uuid primary key default gen_random_uuid(),
  visit_id          uuid not null references public.store_visits(id),
  store_id          uuid not null references public.stores(id),      -- server-filled from the visit
  user_id           uuid not null default auth.uid() references public.users(id),
  product_id        uuid not null references public.products(id),
  quantity          int  not null check (quantity between 1 and 48),  -- for THIS customer
  switched_from_id  uuid not null references public.competitor_brands(id),
  note              text check (note is null or char_length(note) <= 200),
  photo_path        text,               -- null once purged (90 days)
  photo_purged_at   timestamptz,
  faces_blurred     int  not null default 0 check (faces_blurred >= 0),
  photo_hash        bigint,             -- 64-bit dHash of the uploaded (blurred) image
  duplicate_of      uuid,               -- server-computed; may point at a row the reader can't see
  duplicate_scope   text check (duplicate_scope in ('same_rep','same_store','company')),
  zoom              numeric(3,1) check (zoom >= 1),
  latitude          double precision,
  longitude         double precision,
  accuracy_m        real,
  is_mock_location  boolean not null default false,  -- Android only, as on store_visits
  captured_at       timestamptz not null,            -- device clock at the shutter
  created_at        timestamptz not null default now(),  -- server clock; flags use THIS
  undone_at         timestamptz,                     -- 60-second undo (undo_spot_sale)
  actor_role        text
);
comment on table public.spot_sales is
  'One row per customer conversion, logged as it happens. The photo is a work artifact, not proof of sale; credibility comes from the pattern and from stock depletion. No monetary incentive may attach to the self-reported count.';
create index spot_sales_visit_idx on public.spot_sales (visit_id);
create index spot_sales_user_time_idx on public.spot_sales (user_id, created_at desc);
create index spot_sales_store_time_idx on public.spot_sales (store_id, created_at);
create index spot_sales_hash_idx on public.spot_sales (photo_hash) where photo_hash is not null;

-- Server-owned columns. Whatever the client sends for these is overwritten.
create or replace function public.spot_sale_before_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_store uuid;
  -- ponytail: dHash Hamming threshold, tuned for LITERAL reuse (same image, or a
  -- photo of a photo). Higher values start flagging an honest rep's eight shots
  -- of the same counter. O(n) scan of hashes per insert — fine to ~100k rows.
  c_dup_bits constant int := 4;
  r record;
begin
  select v.store_id into v_store from public.store_visits v where v.id = new.visit_id;
  new.store_id        := v_store;
  new.created_at      := now();
  new.undone_at       := null;
  new.photo_purged_at := null;
  new.duplicate_of    := null;
  new.duplicate_scope := null;
  if new.photo_hash is not null then
    select s.id, s.user_id, s.store_id into r
      from public.spot_sales s
     where s.photo_hash is not null
       and bit_count((s.photo_hash # new.photo_hash)::bit(64)) <= c_dup_bits
     order by (s.user_id = new.user_id) desc, (s.store_id = v_store) desc, s.created_at desc
     limit 1;
    if found then
      new.duplicate_of := r.id;
      new.duplicate_scope := case when r.user_id = new.user_id then 'same_rep'
                                  when r.store_id = v_store then 'same_store'
                                  else 'company' end;
    end if;
  end if;
  return new;
end $$;
create trigger trg_spot_sale_before_insert before insert on public.spot_sales
  for each row execute function public.spot_sale_before_insert();
-- Same function as the other four tables. BEFORE triggers fire by name: trg_sp… then trg_st…
create trigger trg_stamp_actor_role before insert or update on public.spot_sales
  for each row execute function public.stamp_actor_role();

alter table public.spot_sales enable row level security;
-- A1–A4 pattern: pinned to auth.uid() AND to the writer's own OPEN visit
-- (the check-in gate, in the database), and the photo to the writer's folder.
create policy "SpotSales: insert own at open visit" on public.spot_sales for insert to authenticated
  with check (
    user_id = auth.uid()
    and public.get_my_role() is not null
    and exists (select 1 from public.store_visits v
                 where v.id = spot_sales.visit_id and v.user_id = auth.uid()
                   and v.check_out_time is null)
    and (photo_path is null or photo_path like 'spot-sales/' || auth.uid()::text || '/%')
  );
create policy "SpotSales: read own" on public.spot_sales for select to authenticated
  using (user_id = auth.uid());
create policy "SpotSales: manager read" on public.spot_sales for select to authenticated
  using (public.get_my_role() = 'management' or public.manages_rep(user_id));
-- No UPDATE / DELETE policy and no grant: the undo RPC and the purge job are the only mutators.
grant select, insert on public.spot_sales to authenticated;

-- 60-second undo. Soft (undone_at), so how often a rep undoes is itself visible.
create or replace function public.undo_spot_sale(p_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update public.spot_sales
     set undone_at = now()
   where id = p_id and user_id = auth.uid() and undone_at is null
     and created_at > now() - interval '60 seconds'
     and public.get_my_role() is not null;
  if not found then
    raise exception 'This sale can no longer be undone — it locks 60 seconds after logging.';
  end if;
  return true;
end $$;
revoke execute on function public.undo_spot_sale(uuid) from public, anon;
grant execute on function public.undo_spot_sale(uuid) to authenticated;

-- ── §1d  spot-sale-photos bucket ────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('spot-sale-photos', 'spot-sale-photos', false, 2097152, array['image/jpeg']);
-- Upload into your own folder only.
create policy "SpotSale bucket: upload own" on storage.objects for insert to authenticated
  with check (bucket_id = 'spot-sale-photos' and public.get_my_role() is not null
              and (storage.foldername(name))[1] = 'spot-sales'
              and (storage.foldername(name))[2] = auth.uid()::text);
-- Read = the spot_sales row rule (self, management, the rep's manager). Stricter
-- than visit-photos (which any authenticated user can read for rep uploads):
-- these are photos of the public, so peers never see them, and an SM's own are
-- management-only because manages_rep excludes non-reps for SMs.
create policy "SpotSale bucket: read" on storage.objects for select to authenticated
  using (bucket_id = 'spot-sale-photos'
         and (owner = auth.uid() or public.get_my_role() = 'management' or public.manages_rep(owner)));
-- The 90-day rule, written AS a policy. The purge job calls the Storage API
-- with the public anon key (there is no service-role key in this project), so
-- anon may select+delete exactly the objects that are already past retention —
-- the only thing anyone can do with it is what the policy obliges us to do.
-- Residual: an expired object is fetchable by someone holding its exact
-- (random) path for at most the hour before the job deletes it.
create policy "SpotSale bucket: expired readable for purge" on storage.objects for select to anon
  using (bucket_id = 'spot-sale-photos' and created_at < now() - interval '90 days');
create policy "SpotSale bucket: expired deletable for purge" on storage.objects for delete to anon
  using (bucket_id = 'spot-sale-photos' and created_at < now() - interval '90 days');

-- ── §2  90-day purge (pg_cron, hourly) ───────────────────────────────────────
create or replace function public.purge_spot_sale_photos()
returns void language plpgsql security definer set search_path = '' as $$
declare v_names text[];
begin
  -- 1. Record purges that LANDED: a row is marked only once its object is
  --    actually gone from storage, never on the strength of a request sent.
  update public.spot_sales s
     set photo_path = null, photo_purged_at = now()
   where s.photo_path is not null
     and s.created_at < now() - interval '90 days'
     and not exists (select 1 from storage.objects o
                      where o.bucket_id = 'spot-sale-photos' and o.name = s.photo_path);
  -- 2. Ask the Storage API to delete every expired object (orphans included —
  --    an upload whose row insert failed is still a photo of a member of the public).
  select array_agg(o.name) into v_names from (
    select name from storage.objects
     where bucket_id = 'spot-sale-photos' and created_at < now() - interval '90 days'
     limit 1000) o;
  if v_names is null then return; end if;
  perform net.http_delete(
    url     := 'https://ldgunrxceogfrohjrlxz.supabase.co/storage/v1/object/spot-sale-photos',
    headers := jsonb_build_object('apikey', '__ANON_KEY__', 'Authorization', 'Bearer __ANON_KEY__',
                                  'Content-Type', 'application/json'),
    body    := jsonb_build_object('prefixes', to_jsonb(v_names)));
end $$;
revoke execute on function public.purge_spot_sale_photos() from public, anon, authenticated;
select cron.schedule('purge-spot-sale-photos', '7 * * * *', 'select public.purge_spot_sale_photos()');

-- ── §3  zoom per photo (shelf / stock photos; spot sales carry it above) ────
alter table public.store_visit_photos
  add column zoom numeric(3,1) check (zoom is null or zoom >= 1);

-- ── §4  compulsory stock: skipping needs a reason ───────────────────────────
alter table public.store_visits
  add column stock_skip_reason text check (stock_skip_reason in
    ('owner_unavailable','godown_locked','shop_busy','section_closed','other')),
  add column stock_skip_note text check (stock_skip_note is null or char_length(stock_skip_note) <= 200),
  add constraint store_visits_skip_other_needs_note
    check (stock_skip_reason is distinct from 'other' or char_length(btrim(coalesce(stock_skip_note,''))) > 0);
-- Rep writes these through the existing "Visits: update own" policy. Not
-- DB-required at checkout: 1.4.0 phones (no skip UI) would be unable to check
-- out until they update. Enforced in the stepper; a visit closed with neither a
-- count nor a reason is a derived flag instead.

-- ── §5  privacy-notice acknowledgement ──────────────────────────────────────
alter table public.users
  add column policy_version text,
  add column policy_acknowledged_at timestamptz;
-- Users have no self-update policy, deliberately (CLAUDE.md RLS). This definer
-- RPC writes ONLY these two columns of the caller's own row.
create or replace function public.acknowledge_policy(p_version text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_version is null or char_length(p_version) > 20 then
    raise exception 'Invalid policy version.';
  end if;
  update public.users set policy_version = p_version, policy_acknowledged_at = now()
   where id = auth.uid() and is_active;
end $$;
revoke execute on function public.acknowledge_policy(text) from public, anon;
grant execute on function public.acknowledge_policy(text) to authenticated;

-- ── §6  location view: keep the audit log, drop the push ────────────────────
create or replace function public.on_location_viewed()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- Every view is logged (this row + the shown position). The rep is no longer
  -- notified (owner decision 2026-10-11); the log is what the privacy notice §6
  -- points to as evidence of proportionate use, so it must stay.
  update public.location_requests lr
     set lat = rp.lat, lng = rp.lng, responded_at = rp.recorded_at, status = 'completed'
    from public.rep_positions rp
   where lr.id = new.id and rp.rep_id = new.rep_id;
  return new;
end $$;
