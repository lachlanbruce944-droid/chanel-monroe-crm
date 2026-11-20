
create or replace function public.crm_associate_publication_guard()
returns trigger language plpgsql security invoker set search_path=public as $$
begin
 if new.kind='team' and (new.status<>'active' or coalesce(new.extra->>'connectionStatus','prospect')<>'connected' or nullif(new.extra->>'contactedAt','') is null)
 then new.show_on_site:=false; end if;
 if new.show_on_site and new.kind='team' then
  if not exists(select 1 from crm_staff where user_id=auth.uid() and role='owner') and current_user<>'service_role'
  then raise exception 'Only the owner publishes associate profiles';end if;
 end if;
 return new;
end $$;
revoke all on function public.crm_associate_publication_guard() from public,anon,authenticated;
create trigger crm_associate_publication_guard before insert or update on public.crm_people
 for each row execute function public.crm_associate_publication_guard();
create or replace function public.crm_publish_associate(p_person uuid,p_publish boolean)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare p crm_people;
begin
 if not exists(select 1 from crm_staff where user_id=auth.uid() and role='owner') then raise exception 'Only the owner publishes associates';end if;
 select * into p from crm_people where id=p_person for update;
 if not found or p.kind<>'team' then raise exception 'Associate not found';end if;
 if p_publish and (p.status<>'active' or p.extra->>'connectionStatus' is distinct from 'connected' or nullif(p.extra->>'contactedAt','') is null)
 then raise exception 'Record outreach and a confirmed connection before publishing';end if;
 update crm_people set show_on_site=p_publish,extra=extra||jsonb_build_object('publishedAt',case when p_publish then now() else null end),updated_at=now() where id=p_person;
 return jsonb_build_object('ok',true,'published',p_publish);
end $$;
revoke all on function public.crm_publish_associate(uuid,boolean) from public,anon;
grant execute on function public.crm_publish_associate(uuid,boolean) to authenticated;
create or replace function public.site_team()
returns table(name text,role text,instagram text,photo_url text)
language sql stable security definer set search_path=public as $$
 select coalesce(nullif(trim(concat_ws(' ',first_name,last_name)),''),business_name), role, instagram, photo_url
 from public.crm_people
 where kind='team' and status='active' and show_on_site
 and extra->>'connectionStatus'='connected' and nullif(extra->>'contactedAt','') is not null
 order by created_at;
$$;
revoke all on function public.site_team() from public;
grant execute on function public.site_team() to anon,authenticated;
