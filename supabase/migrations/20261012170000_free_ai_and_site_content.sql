-- EliahTech free-only AI and structured public identity/content.
-- Additive, repeatable, and uses existing settings/services/categories/social_links tables.
-- Never stores provider credentials in SQL.

-- Explicit classification is required before any provider/model can be routed.
alter table public.ai_providers add column if not exists is_free boolean not null default false;
alter table public.ai_models add column if not exists is_free boolean not null default false;

-- Expand provider adapters to include the verified Groq-compatible endpoint while retaining the reusable generic adapter.
alter table public.ai_providers drop constraint if exists ai_providers_adapter_check;

-- Seed only providers with a currently documented free API tier. Runtime routing additionally requires is_free=true
-- on both provider and model; paid/unknown legacy integrations are removed from the active configuration.
insert into public.ai_providers (code, display_name, adapter, base_url, api_key_env, enabled, is_free)
values
  ('gemini', 'Google Gemini (Free tier)', 'gemini', 'https://generativelanguage.googleapis.com/v1beta', 'GEMINI_API_KEY', true, true),
  ('groq', 'Groq (Free plan)', 'groq', 'https://api.groq.com/openai/v1', 'GROQ_API_KEY', true, true)
on conflict (code) do update set
  display_name = excluded.display_name,
  adapter = excluded.adapter,
  base_url = excluded.base_url,
  api_key_env = excluded.api_key_env,
  is_free = true,
  updated_at = now();

-- Detach and retire xAI/Grok and unclassified generic integrations. Their model records remain as disabled history,
-- but cannot be selected or called. Never migrate an unknown/custom endpoint as free.
update public.ai_models m set
  enabled = false,
  free_user_enabled = false,
  premium_user_enabled = false,
  is_free = false,
  provider_id = null,
  updated_at = now()
where m.provider_id in (select p.id from public.ai_providers p where p.adapter in ('grok', 'openai_compatible'));
delete from public.ai_providers where adapter in ('grok', 'openai_compatible');
alter table public.ai_providers add constraint ai_providers_adapter_check
  check (adapter in ('gemini', 'groq', 'openai_compatible'));

-- Disable old or unknown models. Only exact provider/model pairs listed below are activated as free.
update public.ai_models set enabled = false, free_user_enabled = false, premium_user_enabled = false, is_free = false, updated_at = now()
where slug not in ('groq-gpt-oss-20b', 'gemini-3-5-flash-lite');

insert into public.ai_models
  (slug, display_name, provider_id, model_identifier, capabilities, enabled, priority, free_user_enabled,
   premium_user_enabled, is_free, max_tokens, temperature, timeout_ms, daily_limit, monthly_limit)
select 'groq-gpt-oss-20b', 'GPT OSS 20B (Groq Free)', p.id, 'openai/gpt-oss-20b',
       '{general,reasoning,coding,writing,summarization}', true, 10, true, true, true, 2048, 0.4, 20000, 1000, 20000
from public.ai_providers p where p.code = 'groq'
on conflict (slug) do update set
  display_name = excluded.display_name, provider_id = excluded.provider_id, model_identifier = excluded.model_identifier,
  capabilities = excluded.capabilities, enabled = true, priority = excluded.priority, free_user_enabled = true,
  premium_user_enabled = true, is_free = true, max_tokens = excluded.max_tokens, temperature = excluded.temperature,
  timeout_ms = excluded.timeout_ms, daily_limit = excluded.daily_limit, monthly_limit = excluded.monthly_limit, updated_at = now();

insert into public.ai_models
  (slug, display_name, provider_id, model_identifier, capabilities, enabled, priority, free_user_enabled,
   premium_user_enabled, is_free, max_tokens, temperature, timeout_ms, daily_limit, monthly_limit)
select 'gemini-3-5-flash-lite', 'Gemini 3.5 Flash-Lite (Free tier)', p.id, 'gemini-3.5-flash-lite',
       '{general,reasoning,coding,writing,translation,summarization,fast,seo,creative,data_analysis}', true, 20, true, true, true, 2048, 0.4, 20000, 1000, 20000
from public.ai_providers p where p.code = 'gemini'
on conflict (slug) do update set
  display_name = excluded.display_name, provider_id = excluded.provider_id, model_identifier = excluded.model_identifier,
  capabilities = excluded.capabilities, enabled = true, priority = excluded.priority, free_user_enabled = true,
  premium_user_enabled = true, is_free = true, max_tokens = excluded.max_tokens, temperature = excluded.temperature,
  timeout_ms = excluded.timeout_ms, daily_limit = excluded.daily_limit, monthly_limit = excluded.monthly_limit, updated_at = now();

-- Curated public site profile stored in the existing public settings table. Re-runs preserve admin edits.
insert into public.settings (key, value, is_public) values
('site', jsonb_build_object(
  'brand_name', 'EliahTech',
  'gaming_identity', 'EliahTech Gaming',
  'website_url', '',
  'tagline', 'Gaming & Technology Platform',
  'description', 'EliahTech is a gaming and technology platform focused on PSP and PPSSPP games and mods, football games and updates, Android games and mods, game installation and setup guides, game graphics and textures, technology tutorials, and AI tools and tutorials. The platform provides useful gaming downloads, updates, tutorials, modification guides, technology tips and AI-related content for its audience.',
  'about_title', 'A practical gaming and technology platform',
  'about_lead', 'EliahTech shares useful, accessible information about games, technology and digital tools.',
  'about_text', 'Explore PSP and PPSSPP games and mods, football games, Android games, updates, graphics, textures, installation guides, technology tutorials, AI tools and practical digital resources.\n\nOur focus is on clear, useful information that helps people learn, set up and troubleshoot. EliahTech does not claim to publish, develop, distribute or own third-party games.',
  'seo_title', 'EliahTech – PSP, PPSSPP, Football Games, Android Games, Mods, Tech & AI Tutorials',
  'seo_description', 'EliahTech is a gaming and technology platform featuring PSP and PPSSPP games and mods, football games and updates, Android games and mods, installation guides, game graphics and textures, tech tips, and AI tools and tutorials.',
  'canonical_url', '',
  'contact_faqs', jsonb_build_array(
    jsonb_build_object('question', 'How long does a reply take?', 'answer', 'Usually within two business days. Project enquiries with clear details get a faster and more useful answer.'),
    jsonb_build_object('question', 'Can you help with a project outside the listed services?', 'answer', 'Often yes. Describe what you need and we will tell you honestly whether we are the right fit.'),
    jsonb_build_object('question', 'Where can I report a broken link or a mistake?', 'answer', 'Use this form with the subject Correction and include the page address.'),
    jsonb_build_object('question', 'I want my content removed.', 'answer', 'Send a message with the subject DMCA or Privacy request. See the DMCA and Privacy pages for details.')
  )
), true)
on conflict (key) do nothing;

-- Preserve an existing admin-owned site document while supplying FAQ defaults only if absent.
update public.settings set value = value || jsonb_build_object('contact_faqs', jsonb_build_array(
  jsonb_build_object('question', 'How long does a reply take?', 'answer', 'Usually within two business days. Project enquiries with clear details get a faster and more useful answer.'),
  jsonb_build_object('question', 'Can you help with a project outside the listed services?', 'answer', 'Often yes. Describe what you need and we will tell you honestly whether we are the right fit.'),
  jsonb_build_object('question', 'Where can I report a broken link or a mistake?', 'answer', 'Use this form with the subject Correction and include the page address.'),
  jsonb_build_object('question', 'I want my content removed.', 'answer', 'Send a message with the subject DMCA or Privacy request. See the DMCA and Privacy pages for details.')
)) where key = 'site' and not (value ? 'contact_faqs');

-- Canonical categories; existing historic categories are disabled rather than deleted, preserving post references.
update public.categories set enabled = false, updated_at = now()
where slug in ('psp-games', 'modded-apps', 'gaming-tutorials', 'tech-tricks', 'game-updates', 'android-tips');
insert into public.categories (slug, name, description, icon, enabled, sort_order) values
('psp-ppsspp-games', 'PSP & PPSSPP Games', 'PSP and PPSSPP games, updates, mods, patches and related resources.', 'fa-gamepad', true, 1),
('football-games-updates', 'Football Games & Updates', 'Football gaming content, updates, mods, patches, squads, kits and graphics.', 'fa-futbol', true, 2),
('android-games-mods', 'Android Games & Mods', 'Android games, updates, mods, patches and installation resources.', 'fa-mobile-screen-button', true, 3),
('game-installation-setup', 'Game Installation & Setup', 'Step-by-step game installation, configuration and troubleshooting guides.', 'fa-screwdriver-wrench', true, 4),
('game-graphics-textures-mods', 'Game Graphics, Textures & Mods', 'Game graphics, textures, patches and other visual modifications.', 'fa-palette', true, 5),
('tech-tips-tutorials', 'Tech Tips & Tutorials', 'Technology tips, tutorials, troubleshooting and practical digital information.', 'fa-microchip', true, 6),
('ai-tools-tutorials', 'AI Tools, Tips & Tutorials', 'AI tools, practical tutorials, prompts, productivity and automation guides.', 'fa-robot', true, 7)
on conflict (slug) do update set name = excluded.name, description = excluded.description, icon = excluded.icon,
  enabled = true, sort_order = excluded.sort_order, updated_at = now();

-- Official services use existing service fields. No unprovided prices, contact details or unsupported claims are added.
insert into public.services (slug, title, description, icon, features, price, currency, availability, action_text, action_url, is_active, sort_order)
values
('psp-ppsspp-games-mods', 'PSP & PPSSPP Games and Mods', 'PSP and PPSSPP games, updates, mods, patches, savedata, textures, graphics and related gaming resources.', 'fa-gamepad', '[]', null, null, 'available', 'Explore guides', '/category/psp-ppsspp-games', true, 1),
('football-games-updates', 'Football Games & Updates', 'Football gaming content including PSP, Android and other football game updates, mods, patches, squads, kits, graphics and related resources.', 'fa-futbol', '[]', null, null, 'available', 'Explore updates', '/category/football-games-updates', true, 2),
('android-games-mods', 'Android Games & Mods', 'Android games, updates, mods, patches, APK-related guides, game files, graphics and installation resources.', 'fa-mobile-screen-button', '[]', null, null, 'available', 'Explore guides', '/category/android-games-mods', true, 3),
('game-installation-setup-guides', 'Game Installation & Setup Guides', 'Step-by-step guides for installing, configuring and troubleshooting games, PPSSPP games, Android games, mods, textures, savedata and related files.', 'fa-screwdriver-wrench', '[]', null, null, 'available', 'View guides', '/category/game-installation-setup', true, 4),
('game-graphics-textures-mods', 'Game Graphics, Textures & Mods', 'Game graphics, textures, visual modifications, patches, custom assets and modding resources designed to improve or transform gaming experiences.', 'fa-palette', '[]', null, null, 'available', 'Explore graphics', '/category/game-graphics-textures-mods', true, 5),
('tech-tips-tutorials', 'Tech Tips & Tutorials', 'Technology tips, tutorials, troubleshooting guides, useful tools, software guides, digital solutions and practical technology information.', 'fa-microchip', '[]', null, null, 'available', 'Explore tutorials', '/category/tech-tips-tutorials', true, 6),
('ai-tools-tips-tutorials', 'AI Tools, Tips & Tutorials', 'AI tools, practical AI tutorials, prompts, productivity techniques, AI resources, automation ideas and guides for using artificial intelligence.', 'fa-robot', '[]', null, null, 'available', 'Explore AI', '/category/ai-tools-tutorials', true, 7)
on conflict (slug) do update set title = excluded.title, description = excluded.description, icon = excluded.icon,
  features = excluded.features, price = excluded.price, currency = excluded.currency, availability = excluded.availability,
  action_text = excluded.action_text, action_url = excluded.action_url, is_active = true, sort_order = excluded.sort_order, updated_at = now();

-- Update only the seed copy if it remains unchanged; preserve any custom homepage text set by an admin.
update public.settings set value = jsonb_set(jsonb_set(value, '{hero_title}', to_jsonb('Gaming, technology and digital solutions for curious people.'::text)),
'{hero_description}', to_jsonb('Explore practical PSP and PPSSPP gaming, football and Android game updates, setup guides, tech tips and AI tutorials from EliahTech.'::text)), updated_at = now()
where key = 'homepage' and value->>'hero_title' in ('Gaming, technology & digital solutions.', 'Gaming, technology and digital solutions.')
  and is_public = true;

-- Add useful home modules while retaining the admin's section order/copy and remaining repeatable.
update public.settings set value = jsonb_set(value, '{sections}', coalesce(value->'sections', '[]'::jsonb) ||
  '[{"key":"ai","enabled":true,"eyebrow":"ELIAHTECH AI","title":"Ask about games, tech and digital tools"},{"key":"premium","enabled":true,"eyebrow":"PREMIUM","title":"Go deeper with EliahTech"}]'::jsonb), updated_at = now()
where key = 'homepage' and is_public = true and not coalesce(value->'sections', '[]'::jsonb) @> '[{"key":"ai"}]'::jsonb;

-- Optional per-service metadata remains in the existing services table and is editable in the existing CMS.
alter table public.services add column if not exists seo_title text;
alter table public.services add column if not exists seo_description text;

-- Official social profile URLs supplied in the project brief. WhatsApp is insert-only so an existing newer channel URL survives.
insert into public.social_links (platform, url, icon, enabled, sort_order) values
('Telegram', 'https://t.me/eliahtech', 'fa-telegram', true, 1),
('Facebook', 'https://facebook.com/eliahtech', 'fa-facebook-f', true, 2),
('Instagram', 'https://instagram.com/eliasjuma108', 'fa-instagram', true, 3),
('YouTube', 'https://youtube.com/@eliahtech?si=2pYYSpc1c2fN6lTM', 'fa-youtube', true, 5)
on conflict (platform) do update set url = excluded.url, icon = excluded.icon, enabled = true, sort_order = excluded.sort_order
;

-- The first migration's prior provider defaults included xAI. Remaining model access is exclusively free-tier scoped.
update public.settings set value = value || jsonb_build_object('free_failover', true, 'failover_enabled', true,
  'default_model', coalesce(nullif(value->>'default_model', ''), 'groq-gpt-oss-20b'),
  'upgrade_message', 'EliahTech AI uses free-plan providers only. Availability depends on provider free-tier limits.')
where key = 'ai';
