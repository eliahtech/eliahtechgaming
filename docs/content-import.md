# Content import

content/import.sql contains two recovered short HTML artifacts as drafts. Exact originals are in content/import-sources; import-inventory.json records missing covers, completeness and unverified links. Neither artifact is certified complete/publishable.

Run node scripts/content-import.mjs to regenerate SQL. It sanitizes HTML, escapes SQL values and leaves matching slugs unchanged. Review rights, covers, formatting and download links before publishing. Nothing has been imported into your live database.

## Blogger backup

1. Export the Blogger Atom/XML content backup.
2. Run: python3 scripts/blogger-to-json.py blogger-export.xml content/blogger-posts.json
3. Review the normalized JSON; supply known featured_image_url and SEO fields as appropriate. Assign categories/installation guides in the dashboard after import.
4. Run: node scripts/content-import.mjs content/blogger-posts.json content/blogger-import.sql
5. Review the SQL/inventory and apply through Supabase after a backup.
6. Review/publish drafts in the dashboard.

The converter preserves supplied titles, article HTML, labels, dates and original URL provenance. All imports default to drafts. Unsafe scripts/styles are removed. Missing values are not invented. Set old-site redirects separately if you control that site.

XML entities and oversized exports are rejected. A successful import does not verify external download links.

