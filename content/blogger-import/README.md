# Blogger import (80 published posts, free)

1. In Supabase, make a backup, then run `part-01.sql`, `part-02.sql`, `part-03.sql`, `part-04.sql` in the SQL Editor, in order.
2. Check Admin -> Posts. Use `review-report.json` to see which posts need a category check or have no image.
3. Re-running is safe: posts whose slug already exists are left unchanged.
4. Old Blogger addresses (/2025/11/name.html) redirect to /posts/name automatically.

To regenerate: `node scripts/blogger-takeout-import.mjs "<path>/ELIAHTECH/feed.atom" content/blogger-import`
