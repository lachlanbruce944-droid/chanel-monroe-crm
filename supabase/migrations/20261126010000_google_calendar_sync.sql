create table public.crm_google_calendar_state (
  id boolean primary key default true check (id),
  token_hash bytea not null,
  busy jsonb not null default '[]',
  synced_at timestamptz
);
alter table public.crm_google_calendar_state enable row level security;
revoke all on public.crm_google_calendar_state from public, anon, authenticated;

create function public.crm_google_calendar_pair(p_token text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.crm_staff where user_id = auth.uid() and role = 'owner') then
    raise exception 'Only the CRM owner can pair Google Calendar';
  end if;
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then raise exception 'Invalid pairing key'; end if;
  insert into public.crm_google_calendar_state(id, token_hash)
    values (true, pg_catalog.sha256(convert_to(p_token, 'UTF8')))
    on conflict (id) do update set token_hash = excluded.token_hash, synced_at = null;
end;
$$;

create function public.crm_google_calendar_read()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.crm_staff where user_id = auth.uid()) then
    raise exception 'CRM staff access required';
  end if;
  return coalesce((select jsonb_build_object('paired', true, 'syncedAt', synced_at, 'busy', busy)
    from public.crm_google_calendar_state where id), '{"paired":false,"busy":[]}'::jsonb);
end;
$$;

create function public.crm_google_calendar_sync(p_token text, p_busy jsonb default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if p_busy is not null then
    perform pg_advisory_xact_lock(hashtext('crm-consultation-calendar'));
  end if;
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' or not exists (
    select 1 from public.crm_google_calendar_state
    where id and token_hash = pg_catalog.sha256(convert_to(p_token, 'UTF8')) for update
  ) then raise exception using errcode = '28000', message = 'Invalid calendar pairing key'; end if;
  if p_busy is not null then
    if jsonb_typeof(p_busy) <> 'array' then raise exception 'Expected busy intervals'; end if;
    if jsonb_array_length(p_busy) > 10000 or exists (
      select 1 from jsonb_to_recordset(p_busy) as block(start_at timestamptz, end_at timestamptz, all_day boolean)
      where block.start_at is null or block.end_at is null or block.all_day is null
        or block.start_at >= block.end_at or not isfinite(block.start_at) or not isfinite(block.end_at)
    ) then raise exception 'Invalid busy intervals'; end if;
    update public.crm_google_calendar_state set busy = (
      select coalesce(jsonb_agg(to_jsonb(block)), '[]')
      from jsonb_to_recordset(p_busy) as block(start_at timestamptz, end_at timestamptz, all_day boolean)
    ), synced_at = now() where id;
    return '{}'::jsonb;
  end if;
  return (
    with holds as (
      select b.id, b.stage, b.event_date, b.call_at, b.call_logged_at, b.extra,
        coalesce(nullif(b.extra->>'calendarStart','')::timestamptz,
          (b.event_date+b.start_time) at time zone 'Australia/Brisbane',
          ((b.event_date+b.ready_by) at time zone 'Australia/Brisbane') - interval '3 hours') as starts
      from public.crm_bookings b
      where b.status <> 'lost' and nullif(b.extra->>'archivedAt','') is null
    ), events as (
      select id::text || ':makeup' as key,
        case when stage in ('booked','day','complete') then 'Makeup appointment' else 'Makeup enquiry hold' end as title,
        coalesce(starts, event_date::timestamp at time zone 'Australia/Brisbane') as start_at,
        case when starts is null then (event_date+1)::timestamp at time zone 'Australia/Brisbane'
          else coalesce(nullif(extra->>'calendarEnd','')::timestamptz, starts+interval '3 hours')
            + make_interval(mins=>coalesce((extra->>'calendarBufferMins')::integer,60)) end as end_at,
        case when starts is null then event_date end as all_day
      from holds
      union all
      select id::text || ':phone',
        case when extra#>>'{consultation,status}' = 'confirmed' then 'Phone consult · approved' else 'Phone consult · pending' end,
        call_at, call_at+interval '15 minutes', null::date
      from holds where call_logged_at is null
    )
    select jsonb_build_object('events', coalesce(jsonb_agg(to_jsonb(events)), '[]'))
    from events where end_at > now() and start_at < now()+interval '430 days' and end_at > start_at
  );
end;
$$;

revoke all on function public.crm_google_calendar_pair(text), public.crm_google_calendar_read(),
  public.crm_google_calendar_sync(text,jsonb) from public, anon, authenticated;
grant execute on function public.crm_google_calendar_pair(text), public.crm_google_calendar_read() to authenticated;
grant execute on function public.crm_google_calendar_sync(text,jsonb) to anon;

create function public.crm_google_calendar_conflict(p_start timestamptz, p_end timestamptz)
returns boolean language sql stable set search_path = '' as $$
  select exists (
    select 1 from public.crm_google_calendar_state s
    cross join lateral jsonb_to_recordset(s.busy) as b(start_at timestamptz,end_at timestamptz)
    where b.start_at < p_end and b.end_at > p_start
  );
$$;
revoke all on function public.crm_google_calendar_conflict(timestamptz,timestamptz) from public, anon, authenticated;

create or replace function public.crm_enquiry_slot_free(slot_start timestamptz,slot_end timestamptz)
returns boolean language sql stable set search_path='' as $$
 select not public.crm_google_calendar_conflict(slot_start, slot_end) and not exists(select 1 from public.crm_bookings b cross join lateral (
   select coalesce(nullif(b.extra->>'calendarStart','')::timestamptz,
    (b.event_date+b.start_time) at time zone 'Australia/Brisbane',
    ((b.event_date+b.ready_by) at time zone 'Australia/Brisbane')-interval '3 hours') a
 ) t where b.status <> 'lost' and (
   (t.a < slot_end and coalesce(nullif(b.extra->>'calendarEnd','')::timestamptz,t.a+interval '3 hours')
      +make_interval(mins=>coalesce((b.extra->>'calendarBufferMins')::integer,60)) > slot_start)
   or (b.call_logged_at is null and b.call_at < slot_end and b.call_at+interval '15 minutes'>slot_start)
   or (t.a is null and b.stage in ('booked','day') and (b.event_date::timestamp at time zone 'Australia/Brisbane')<slot_end
    and ((b.event_date+1)::timestamp at time zone 'Australia/Brisbane')>slot_start)
 ));
$$;
revoke all on function public.crm_enquiry_slot_free(timestamptz,timestamptz) from public,anon,authenticated;

create function public.crm_guard_google_calendar()
returns trigger language plpgsql security definer set search_path = '' as $$
declare starts timestamptz; ends timestamptz;
  check_phone boolean := true;
  check_makeup boolean := true;
begin
  if new.status = 'lost' then return new; end if;
  if tg_op = 'UPDATE' then
    check_phone := new.call_at is distinct from old.call_at
      or new.extra#>>'{consultation,status}' is distinct from old.extra#>>'{consultation,status}';
    check_makeup := new.event_date is distinct from old.event_date
      or new.start_time is distinct from old.start_time or new.ready_by is distinct from old.ready_by
      or new.extra->>'calendarStart' is distinct from old.extra->>'calendarStart'
      or new.extra->>'calendarEnd' is distinct from old.extra->>'calendarEnd'
      or new.extra->>'calendarBufferMins' is distinct from old.extra->>'calendarBufferMins'
      or (new.stage in ('booked','day') and new.stage is distinct from old.stage)
      or old.status = 'lost';
  end if;
  if check_phone and new.call_logged_at is null
    and public.crm_google_calendar_conflict(new.call_at, new.call_at+interval '15 minutes') then
    raise exception 'Phone consultation overlaps Google Calendar busy time';
  end if;
  if check_makeup and (new.website_enquiry_id is null or nullif(new.extra->>'calendarStart','') is not null) then
    starts := coalesce(nullif(new.extra->>'calendarStart','')::timestamptz,
      (new.event_date+new.start_time) at time zone 'Australia/Brisbane',
      ((new.event_date+new.ready_by) at time zone 'Australia/Brisbane') - interval '3 hours');
    ends := coalesce(nullif(new.extra->>'calendarEnd','')::timestamptz, starts+interval '3 hours')
      + make_interval(mins=>coalesce((new.extra->>'calendarBufferMins')::integer,60));
    if starts is null then
      starts := new.event_date::timestamp at time zone 'Australia/Brisbane';
      ends := (new.event_date+1)::timestamp at time zone 'Australia/Brisbane';
    end if;
    if public.crm_google_calendar_conflict(starts, ends) then
      raise exception 'Makeup appointment overlaps Google Calendar busy time';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.crm_guard_google_calendar() from public, anon, authenticated;
create trigger z_crm_guard_google_calendar before insert or update of
  status, stage, event_date, start_time, ready_by, call_at, extra on public.crm_bookings
for each row execute function public.crm_guard_google_calendar();
