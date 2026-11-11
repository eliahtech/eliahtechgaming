-- Admin CMS: services columns per spec, reusable installation guides on posts, SEO columns, media table + Storage bucket,
-- atomic post-tag replacement and editable homepage sections.

-- Services: align with the spec (is_active, action_text, action_url, image_url).
do $$ begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'services' and column_name = 'enabled') then
    alter table public.services rename column enabled to is_active;
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'services' and column_name = 'cta_label') then
    alter table public.services rename column cta_label to action_text;
  end if;
end $$;
alter table public.services add column if not exists image_url text;
alter table public.services add column if not exists action_url text;
create index if not exists services_active_sort_idx on public.services (is_active, sort_order);

-- Posts: reusable installation guide (rendered live from the guide, never copied), SEO fields, supporting indexes.
alter table public.posts add column if not exists installation_guide_id uuid references public.installation_guides (id) on delete set null;
alter table public.posts add column if not exists canonical_url text;
alter table public.posts add column if not exists og_image text;
create index if not exists posts_guide_idx on public.posts (installation_guide_id);
create index if not exists posts_category_idx on public.posts (category_id);
create index if not exists posts_author_idx on public.posts (author_id);
create index if not exists posts_featured_idx on public.posts (featured) where featured;
create index if not exists post_tags_tag_idx on public.post_tags (tag_id);

-- Media library (files live in Supabase Storage, never in Postgres).
create table if not exists public.media (
  id uuid primary key default gen_random_uuid(),
  bucket text not null default 'media',
  path text not null unique,
  public_url text not null,
  mime_type text not null,
  size_bytes integer not null check (size_bytes > 0),
  alt_text text,
  uploaded_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists media_created_idx on public.media (created_at desc);
alter table public.media enable row level security;
create policy "admins manage media" on public.media for all using (public.is_admin()) with check (public.is_admin());
create policy "admins manage guides" on public.installation_guides for all using (public.is_admin()) with check (public.is_admin());
create policy "admins manage tags" on public.tags for all using (public.is_admin()) with check (public.is_admin());
create policy "admins manage post tags" on public.post_tags for all using (public.is_admin()) with check (public.is_admin());

-- Public-read bucket. Only the server (service role) writes. The bucket itself restricts type and size,
-- in addition to the magic-byte checks the API performs before uploading. SVG is deliberately excluded (script risk).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media', 'media', true, 4194304, array['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
on conflict (id) do update set public = true, file_size_limit = 4194304, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

-- Replace a post's tag set in one transaction (called by the API with the service role only).
create or replace function public.admin_set_post_tags(p_post_id uuid, p_tag_ids uuid[]) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from public.post_tags where post_id = p_post_id;
  insert into public.post_tags (post_id, tag_id) select p_post_id, t from unnest(coalesce(p_tag_ids, '{}')) as t on conflict do nothing;
end; $$;
revoke all on function public.admin_set_post_tags(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.admin_set_post_tags(uuid, uuid[]) to service_role;

-- Homepage sections become admin-editable data (order, visibility and copy). These are defaults the admin can change.
update public.settings set value = value || jsonb_build_object(
  'featured_post_slug', null,
  'sections', jsonb_build_array(
    jsonb_build_object('key', 'featured', 'enabled', true, 'eyebrow', 'THE FEATURED SIGNAL', 'title', 'One useful idea to start with.'),
    jsonb_build_object('key', 'latest', 'enabled', true, 'eyebrow', 'LATEST FROM THE FEED', 'title', 'Short reads. Strong signal.', 'description', 'Gaming, Android, tech and the systems around them, kept practical, current and easy to act on.'),
    jsonb_build_object('key', 'categories', 'enabled', true, 'eyebrow', 'EXPLORE BY LANE', 'title', 'Go where your curiosity points.'),
    jsonb_build_object('key', 'services', 'enabled', true, 'eyebrow', 'SERVICES', 'title', 'Have a useful idea? Build it.'),
    jsonb_build_object('key', 'youtube', 'enabled', false, 'eyebrow', 'WATCH', 'title', 'Latest on YouTube', 'video_id', null),
    jsonb_build_object('key', 'newsletter', 'enabled', true, 'eyebrow', 'THE WEEKLY DROP', 'title', 'Good links. Better ideas.', 'description', 'A compact note with the best new guides, releases and useful digital shortcuts.')
  )
) where key = 'homepage' and not (value ? 'sections');
