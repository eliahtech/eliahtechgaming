-- Columns the public API needs, plus default (admin-editable) public settings.
alter table public.posts add column if not exists author_name text;
alter table public.posts add column if not exists reading_time integer not null default 1;
alter table public.services add column if not exists accent text not null default 'violet';

-- Public homepage and premium configuration. Editable by admins; these are defaults, not demo content.
insert into public.settings (key, value, is_public) values
('homepage', '{"hero_title":"Gaming, technology & digital solutions.","hero_description":"Discover practical guides, gaming updates, smart tech tips and premium digital services, curated for people who like their tools useful and their ideas ambitious.","cta_label":"Explore the latest","cta_url":"#latest","secondary_cta_label":"Work with Eliah Tech","secondary_cta_url":"/services","latest_post_count":4}', true),
('premium', '{"status":"coming_soon","price_label":"KSh 499","period":"month","trial_days":3}', true)
on conflict (key) do nothing;
