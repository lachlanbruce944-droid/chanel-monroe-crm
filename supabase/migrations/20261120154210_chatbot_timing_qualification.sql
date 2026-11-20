create or replace function public.crm_chat_timing(p_service text,p_quantity integer)
returns table(duration_mins integer,buffer_mins integer)
language plpgsql stable set search_path='' as $$
declare s public.crm_services%rowtype; n integer:=greatest(1,least(coalesce(p_quantity,1),100)); m integer; b integer;
begin
 select * into s from public.crm_services where active and extra->>'websiteKey'=p_service order by sort,id limit 1;
 if not found then
   if p_service <> 'unsure' then raise exception 'Unknown service'; end if;
   return query select 180,60; return;
 end if;
 m:=greatest(coalesce(s.duration_mins,60),15);
 b:=greatest(0,least(coalesce((s.extra->>'bufferMins')::integer,(select (value#>>'{}')::integer from public.crm_settings where id='appointmentBufferMins'),60),240));
 if p_service='bridal-look' then
   m:=m+(n-1)*coalesce((select greatest(party.duration_mins,15) from public.crm_services party where party.active and party.extra->>'websiteKey'='bridal-party' order by party.sort,party.id limit 1),60);
 elsif coalesce(s.extra->>'unit','') <> 'per booking' and p_service <> 'lesson' then m:=m*n;
 end if;
 return query select (ceil(m/15.0)*15)::integer,b;
end $$;
revoke all on function public.crm_chat_timing(text,integer) from public,anon,authenticated;


