create extension if not exists pgcrypto;
create extension if not exists pg_trgm;
create extension if not exists citext;

create type public.user_role as enum ('guest', 'free_user', 'premium_user', 'admin');
create type public.post_status as enum ('draft', 'published', 'scheduled', 'archived');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  role public.user_role not null default 'free_user',
  email_verified_at timestamptz,
  trial_started_at timestamptz,
  trial_ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.categories (
  id uuid primary key default gen_random_uuid(), slug text unique not null, name text not null,
  description text, icon text, color text, enabled boolean not null default true, sort_order integer not null default 0,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table public.posts (
  id uuid primary key default gen_random_uuid(), author_id uuid references public.profiles(id) on delete set null,
  category_id uuid references public.categories(id) on delete set null, title text not null, slug text unique not null,
  excerpt text, content_html text not null default '', status public.post_status not null default 'draft',
  published_at timestamptz, scheduled_at timestamptz, updated_at timestamptz not null default now(),
  featured boolean not null default false, is_premium boolean not null default false, comments_enabled boolean not null default true,
  featured_image_url text, featured_image_alt text, seo_title text, seo_description text, seo_keywords text[], view_count bigint not null default 0,
  search_vector tsvector generated always as (to_tsvector('english', coalesce(title,'') || ' ' || coalesce(excerpt,'') || ' ' || coalesce(content_html,''))) stored,
  created_at timestamptz not null default now()
);
create index posts_search_idx on public.posts using gin(search_vector);
create index posts_published_idx on public.posts(status, published_at desc);

create table public.tags (id uuid primary key default gen_random_uuid(), name text unique not null, slug text unique not null, created_at timestamptz not null default now());
create table public.post_tags (post_id uuid references public.posts(id) on delete cascade, tag_id uuid references public.tags(id) on delete cascade, primary key(post_id, tag_id));
create table public.post_images (id uuid primary key default gen_random_uuid(), post_id uuid references public.posts(id) on delete cascade, image_url text not null, caption text, alt_text text, sort_order integer not null default 0, created_at timestamptz not null default now());
create table public.videos (id uuid primary key default gen_random_uuid(), post_id uuid references public.posts(id) on delete cascade, youtube_url text not null, title text, description text, sort_order integer not null default 0, created_at timestamptz not null default now());
create table public.installation_guides (id uuid primary key default gen_random_uuid(), title text not null, slug text unique not null, content_html text not null default '', enabled boolean not null default true, updated_at timestamptz not null default now(), created_at timestamptz not null default now());
create table public.downloads (id uuid primary key default gen_random_uuid(), post_id uuid references public.posts(id) on delete cascade, title text not null, description text, url text not null, file_size text, version text, platform text, password_hint text, is_external boolean not null default true, requires_premium boolean not null default false, active boolean not null default true, created_at timestamptz not null default now());
create table public.services (id uuid primary key default gen_random_uuid(), title text not null, slug text unique not null, description text not null, icon text, features jsonb not null default '[]', price text, currency text default 'KES', availability text default 'available', cta_label text default 'Get started', enabled boolean not null default true, sort_order integer not null default 0, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table public.comments (id uuid primary key default gen_random_uuid(), post_id uuid not null references public.posts(id) on delete cascade, user_id uuid not null references public.profiles(id) on delete cascade, body text not null, status text not null default 'pending' check (status in ('pending','approved','rejected')), created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table public.subscribers (id uuid primary key default gen_random_uuid(), email citext unique not null, status text not null default 'pending', verified_at timestamptz, unsubscribe_token text unique not null default encode(gen_random_bytes(24), 'hex'), subscribed_at timestamptz not null default now());
create table public.messages (id uuid primary key default gen_random_uuid(), name text not null, email citext not null, subject text not null, message text not null, status text not null default 'unread' check (status in ('unread','read','archived')), created_at timestamptz not null default now());
create table public.message_replies (id uuid primary key default gen_random_uuid(), message_id uuid not null references public.messages(id) on delete cascade, admin_id uuid references public.profiles(id) on delete set null, body text not null, created_at timestamptz not null default now());
create table public.subscriptions (id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id) on delete cascade, plan text not null, status text not null, trial_started_at timestamptz, trial_ends_at timestamptz, started_at timestamptz, expires_at timestamptz, payment_provider text, provider_subscription_id text, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table public.payments (id uuid primary key default gen_random_uuid(), user_id uuid references public.profiles(id) on delete set null, provider text not null, transaction_id text, amount numeric(12,2) not null, currency text not null, status text not null, payment_method text, metadata jsonb not null default '{}', created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table public.ai_usage (id uuid primary key default gen_random_uuid(), user_id uuid references public.profiles(id) on delete set null, provider text not null, model text, request_count integer not null default 1, tokens integer not null default 0, usage_date date not null default current_date, status text not null default 'success', created_at timestamptz not null default now());
create table public.settings (key text primary key, value jsonb not null default '{}', is_public boolean not null default false, updated_at timestamptz not null default now());
create table public.social_links (id uuid primary key default gen_random_uuid(), platform text not null, url text not null, icon text, enabled boolean not null default true, sort_order integer not null default 0, unique(platform));
create table public.homepage_sections (id uuid primary key default gen_random_uuid(), key text unique not null, title text, description text, enabled boolean not null default true, sort_order integer not null default 0, config jsonb not null default '{}');
create table public.ads (id uuid primary key default gen_random_uuid(), provider text, ad_code text, enabled boolean not null default false, locations text[] not null default '{}', created_at timestamptz not null default now(), updated_at timestamptz not null default now());

create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
begin insert into public.profiles (id, display_name) values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1))); return new; end; $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();

create or replace function public.is_admin() returns boolean language sql stable security definer set search_path = public as $$ select exists(select 1 from public.profiles where id = auth.uid() and role = 'admin'); $$;
create or replace function public.is_premium() returns boolean language sql stable security definer set search_path = public as $$ select exists(select 1 from public.profiles where id = auth.uid() and (role = 'premium_user' or (trial_ends_at is not null and trial_ends_at > now()))); $$;

alter table public.profiles enable row level security;
alter table public.categories enable row level security;
alter table public.posts enable row level security;
alter table public.tags enable row level security;
alter table public.post_tags enable row level security;
alter table public.post_images enable row level security;
alter table public.videos enable row level security;
alter table public.installation_guides enable row level security;
alter table public.downloads enable row level security;
alter table public.services enable row level security;
alter table public.comments enable row level security;
alter table public.subscribers enable row level security;
alter table public.messages enable row level security;
alter table public.message_replies enable row level security;
alter table public.subscriptions enable row level security;
alter table public.payments enable row level security;
alter table public.ai_usage enable row level security;
alter table public.settings enable row level security;
alter table public.social_links enable row level security;
alter table public.homepage_sections enable row level security;
alter table public.ads enable row level security;

create policy "public can read enabled categories" on public.categories for select using (enabled = true);
create policy "public can read published posts" on public.posts for select using (status = 'published' and (is_premium = false or public.is_premium()));
create policy "public can read active services" on public.services for select using (enabled = true);
create policy "public can read enabled social links" on public.social_links for select using (enabled = true);
create policy "public can read public settings" on public.settings for select using (is_public = true);
create policy "users can read own profile" on public.profiles for select using (id = auth.uid());
create policy "users can update own profile" on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());
create policy "users can read own subscriptions" on public.subscriptions for select using (user_id = auth.uid());
create policy "users can read own ai usage" on public.ai_usage for select using (user_id = auth.uid());
create policy "approved comments are public" on public.comments for select using (status = 'approved');
create policy "authenticated users can create comments" on public.comments for insert with check (user_id = auth.uid());
create policy "admins manage everything" on public.profiles for all using (public.is_admin()) with check (public.is_admin());
create policy "admins manage posts" on public.posts for all using (public.is_admin()) with check (public.is_admin());
create policy "admins manage categories" on public.categories for all using (public.is_admin()) with check (public.is_admin());
create policy "admins manage services" on public.services for all using (public.is_admin()) with check (public.is_admin());
create policy "admins manage settings" on public.settings for all using (public.is_admin()) with check (public.is_admin());
create policy "admins manage links" on public.social_links for all using (public.is_admin()) with check (public.is_admin());
create policy "admins manage messages" on public.messages for all using (public.is_admin()) with check (public.is_admin());
create policy "admins manage payments" on public.payments for all using (public.is_admin()) with check (public.is_admin());

insert into public.categories (slug, name, icon, color, sort_order) values
('psp-games','PSP Games','fa-gamepad','#8b5cf6',1),('modded-apps','Modded Apps','fa-mobile-screen-button','#06b6d4',2),('gaming-tutorials','Gaming Tutorials','fa-graduation-cap','#f59e0b',3),('tech-tricks','Tech Tricks','fa-microchip','#22c55e',4),('game-updates','Game Updates','fa-bolt','#ec4899',5),('android-tips','Android Tips','fa-android','#84cc16',6)
on conflict (slug) do nothing;
insert into public.social_links (platform, url, icon, sort_order) values
('Telegram','https://t.me/eliahtech','fa-telegram',1),('Facebook','https://www.facebook.com/eliahtech','fa-facebook-f',2),('Instagram','https://www.instagram.com/eliasjuma108','fa-instagram',3),('WhatsApp','https://whatsapp.com/channel/0029VaPXwjgC6ZvjQ3ocsy12','fa-whatsapp',4),('YouTube','https://youtube.com/@eliahtech','fa-youtube',5)
on conflict (platform) do nothing;
