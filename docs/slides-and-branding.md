# Category slideshow and ETG branding

The visual update needs no additional Supabase migration or environment variables.

## Artwork

`public/slides/` contains 14 original generated background images: two for each of the seven Gaming categories. Every image has a 1600×900 WebP and a smaller 960×540 mobile version. The images are illustrative artwork, not official game screenshots. Generation used the built-in image tool; the prompt set is recorded in `slide-artwork-prompts.json`.

`public/slides-data.js` defines categories, images, short captions and links. It supports up to five entries per category and orders them round-robin so every category appears before its second image. To add a third image, save `category-3.webp` and `category-3-mobile.webp` under `public/slides/` and append its title, description and alt text to that category's slides array. Category keys are football, psp, android, installation, graphics, tech and ai.

## Behavior

The shared header appears on public, account, AI, payment, newsletter and dashboard pages. Every slide links to its relevant category. Normal autoplay advances every 3 seconds and wraps the final image back to the first. Five transition styles cycle: fade, horizontal pan, rise, zoom and reveal.

Previous/next, direct slide buttons, keyboard arrows, touch swipes and Play/Pause are supported. Autoplay pauses when the carousel is off-screen, the tab is hidden, the pointer hovers over it, or keyboard focus is inside it. Reduced-motion visitors start with autoplay paused and get no animated transitions. Play can explicitly start it.

Only the initial image is present as an active source in the HTML; the next image is preloaded. Captions remain readable if an image fails. Mobile layouts put the caption below the artwork, so text does not cover the subjects. The carousel remains a readable first frame without JavaScript.

The SSR templates and JavaScript application share `slides-view.js`; the browser controller is `slideshow.js`. It disposes old listeners/timers when application navigation replaces the header.

## Branding

The latest approved ETG controller emblem with “ELIAHTECH Gaming” beneath it is used unchanged in design. Optimized assets live in `public/assets/branding/`:

- etg-logo.webp for navigation/footer.
- etg-logo.png for high-resolution branding; etg-logo-email.png (320px, ~25 KB) for HTTPS email headers; icon-maskable-512.png for Android adaptive icons.
- icon-32.png, icon-64.png, icon-180.png, icon-192.png and icon-512.png.

`public/favicon.ico` contains 16, 32, 48, 64, 128 and 256 pixel sizes. `site.webmanifest` references the 192/512 icons. No service worker or offline application has been added.

The new logo is configured in both HTML page layouts and the application shell; legacy inline favicons have been removed. APP_URL is used for absolute email-logo URLs when configured with HTTPS.
