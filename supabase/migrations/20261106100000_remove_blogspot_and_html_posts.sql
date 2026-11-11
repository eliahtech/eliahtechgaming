-- Remove the retired Blogger address everywhere it can still live in the database. Safe to run more than once.

-- 1. Social links: the "Website" pointing at the old blog is deleted.
delete from public.social_links where url ilike '%blogspot.com%';

-- 2. Site settings: clear the old address (the app falls back to APP_URL).
update public.settings
   set value = replace(replace(value::text, 'https://eliahtechgaming.blogspot.com', ''), 'http://eliahtechgaming.blogspot.com', '')::jsonb
 where value::text ilike '%eliahtechgaming.blogspot.com%';

-- 3. Posts, installation guides and services that mention it.
update public.posts
   set content_html = regexp_replace(content_html, '<p>\s*(?:Visit:?\s*)?https?://eliahtechgaming\.blogspot\.com/?\s*</p>', '', 'gi')
 where content_html ilike '%eliahtechgaming.blogspot.com%';
update public.posts
   set content_html = regexp_replace(content_html, 'https?://eliahtechgaming\.blogspot\.com/?', '', 'gi')
 where content_html ilike '%eliahtechgaming.blogspot.com%';
update public.posts set canonical_url = null where canonical_url ilike '%eliahtechgaming.blogspot.com%';
update public.posts set og_image = null where og_image ilike '%eliahtechgaming.blogspot.com%';
update public.posts set excerpt = regexp_replace(excerpt, 'https?://eliahtechgaming\.blogspot\.com/?', '', 'gi') where excerpt ilike '%eliahtechgaming.blogspot.com%';
update public.installation_guides
   set content_html = regexp_replace(content_html, 'https?://eliahtechgaming\.blogspot\.com/?', '', 'gi')
 where content_html ilike '%eliahtechgaming.blogspot.com%';
update public.services set action_url = null where action_url ilike '%eliahtechgaming.blogspot.com%';
