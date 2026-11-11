-- ELIAHTECH Gaming: 10 PPSSPP guides for the PSP category.
-- Run in the Supabase SQL Editor against the project's already-migrated database.
-- Every guide is created as a DRAFT so you can read and edit it in the admin panel first.
-- Existing posts with the same slug are left untouched (safe to run more than once).
-- To publish them all at once later, see the last block at the bottom of this file.
begin;

insert into public.posts
 (title,slug,content_html,excerpt,status,published_at,is_premium,category_id,
 featured_image_url,featured_image_alt,author_name,seo_title,seo_description,reading_time)
 values ($q$How to Install PPSSPP on Android and Run Your First PSP Game$q$,'install-ppsspp-android-run-first-psp-game',$q$<p>PPSSPP is a free PSP emulator that runs on Android, Windows, iOS and more. It does not need a PSP BIOS or any extra firmware, so setup is mostly about installing the app and telling it where your games are.</p>

<h2>Step 1: Install PPSSPP from an official source</h2>
<p>Get PPSSPP from Google Play or from the official website, ppsspp.org. Both the free version and <strong>PPSSPP Gold</strong> have the same emulator features; Gold simply supports the developers. Avoid APKs from random sites, because modified copies are a common way to catch malware.</p>

<h2>Step 2: Choose your Memory Stick folder</h2>
<p>The real PSP stored saves on a Memory Stick, so PPSSPP uses an ordinary folder to do the same job. On Android 10 and older it is a folder called <code>PSP</code> in your phone storage. On Android 11 and newer, PPSSPP asks you to create and choose a folder yourself.</p>
<ol>
<li>When PPSSPP opens, tap the option to create or use an existing folder.</li>
<li>Create a folder called <code>PPSSPP</code> in your internal storage and select it.</li>
<li>Allow access when Android asks.</li>
</ol>
<p>You can check or change this later in <strong>Settings &rarr; System</strong>, where there is a Memory Stick location option and a button to show the folder. Everything important lives in this folder: saves, save states, cheats and texture packs.</p>

<h2>Step 3: Prepare your game file</h2>
<p>PPSSPP plays <code>.iso</code>, <code>.cso</code> and <code>.pbp</code> files. If your download is a <code>.zip</code>, <code>.7z</code> or <code>.rar</code> archive, extract it first with a file manager or an app such as ZArchiver, then keep the extracted game file. Use games you own; the emulator itself is legal and free, but game files are copyrighted.</p>
<p>Put your games together in one folder, for example <code>PSP games</code> in internal storage. Avoid keeping them deep inside <code>Android/data</code>, where access is restricted.</p>

<h2>Step 4: Load the game</h2>
<ol>
<li>Open PPSSPP and go to the <strong>Games</strong> tab.</li>
<li>Browse to the folder that holds your game files.</li>
<li>Tap the game to start it.</li>
</ol>

<h2>If your game does not appear</h2>
<ul>
<li>Check that the file ends in <code>.iso</code>, <code>.cso</code> or <code>.pbp</code> and is not still inside an archive.</li>
<li>Make sure you opened the folder that directly contains the file.</li>
<li>If PPSSPP lost access to your folders after an update, choose the folder again from Settings.</li>
</ul>

<h2>What to do next</h2>
<p>Out of the box PPSSPP works on most phones, but you can get smoother play or sharper graphics by tuning a few options. Start with <a href="/posts/best-ppsspp-settings-low-end-android">the best PPSSPP settings for low-end phones</a> or <a href="/posts/best-ppsspp-settings-mid-high-end-android">the settings for mid-range and high-end phones</a>. If something goes wrong, see <a href="/posts/fix-ppsspp-black-screen-crash-game-wont-load">how to fix black screens and crashes</a>.</p>
<p><em>Menu names can differ slightly between PPSSPP versions. If an option is in a different place on your phone, use the search or look in the nearby sections.</em></p>$q$,$q$Install PPSSPP from an official source, choose your Memory Stick folder and load your first PSP game on Android, step by step.$q$,'draft',null,false,
 (select id from public.categories where slug='psp-ppsspp-games' and enabled limit 1),
 '/covers/psp-ppsspp-games.webp',$q$How to Install PPSSPP on Android and Run Your First PSP Game$q$,'ELIAHTECH Gaming',$q$How to Install PPSSPP on Android and Run a PSP Game$q$,$q$Step-by-step PPSSPP setup on Android: install the emulator, choose the Memory Stick folder, add your games and start playing.$q$,3)
 on conflict(slug) do nothing;

insert into public.posts
 (title,slug,content_html,excerpt,status,published_at,is_premium,category_id,
 featured_image_url,featured_image_alt,author_name,seo_title,seo_description,reading_time)
 values ($q$Best PPSSPP Settings for Low-End Android Phones$q$,'best-ppsspp-settings-low-end-android',$q$<p>A phone with limited RAM and a slow chipset can still run many PSP games if PPSSPP is set up sensibly. The goal is simple: ask the phone to do less work per frame. Change <strong>one setting at a time</strong> and test, so you know what actually helped.</p>

<h2>Keep a safe starting point</h2>
<p>Do not edit the global settings for a single hard game. Long-press the game in PPSSPP, open <strong>Game Settings</strong> and create a game config, so your changes apply only to that game.</p>

<h2>Graphics settings</h2>
<ul>
<li><strong>Backend:</strong> try Vulkan first. If the game crashes or shows broken graphics, switch to OpenGL, which is the compatibility option on Android.</li>
<li><strong>Rendering resolution:</strong> set it to <strong>1x PSP</strong>. This is the biggest speed gain, because the phone renders far fewer pixels.</li>
<li><strong>Frameskip:</strong> leave it off first. If the game still runs too slowly, try 1 or 2. Auto frameskip is only worth using on very low-power devices.</li>
<li><strong>Texture scaling, anisotropic filtering and post-processing shaders:</strong> turn them all off. They look nice but cost speed.</li>
<li><strong>Hardware transform and software skinning:</strong> keep them on.</li>
</ul>

<h2>Speed hacks (use carefully)</h2>
<p>These options trade accuracy for speed and can cause glitches in some games, so enable them one by one.</p>
<ul>
<li><strong>Lazy texture caching:</strong> usually safe and helpful. If textures flicker, turn it off again.</li>
<li><strong>Spline/Bezier curves quality:</strong> set to Low.</li>
<li><strong>Skip buffer effects:</strong> a last resort. It can make some games faster, but it may cause missing effects or flickering.</li>
<li><strong>Skip GPU readbacks:</strong> can help in games that use the GPU heavily, at the cost of some effects.</li>
</ul>

<h2>System settings</h2>
<ul>
<li><strong>Fast memory (unstable):</strong> try turning it on for extra speed. If the game crashes, turn it off.</li>
<li><strong>I/O on thread:</strong> can reduce stutter when the game loads data.</li>
<li><strong>CPU clock:</strong> leave it at the default unless a particular game needs a change.</li>
</ul>

<h2>Outside PPSSPP</h2>
<ul>
<li>Turn off battery saver while you play, because it limits the processor.</li>
<li>Close other apps to free memory.</li>
<li>Keep the game file on internal storage rather than a slow memory card.</li>
</ul>
<p>Still slow? Read <a href="/posts/fix-ppsspp-lag-stuttering-slow-speed">how to fix PPSSPP lag and stuttering</a>. If your phone is stronger, see <a href="/posts/best-ppsspp-settings-mid-high-end-android">the mid-range and high-end settings</a>.</p>
<p><em>Menu names can differ slightly between PPSSPP versions. If an option is in a different place on your phone, use the search or look in the nearby sections.</em></p>$q$,$q$Speed up PPSSPP on a phone with limited RAM and a weak processor: resolution, backend, frameskip and speed-hack settings that help.$q$,'draft',null,false,
 (select id from public.categories where slug='psp-ppsspp-games' and enabled limit 1),
 '/covers/psp-ppsspp-games.webp',$q$Best PPSSPP Settings for Low-End Android Phones$q$,'ELIAHTECH Gaming',$q$Best PPSSPP Settings for Low-End Android Phones$q$,$q$Practical PPSSPP settings for low-end Android phones: rendering resolution, backend, frameskip and speed options to reduce lag.$q$,2)
 on conflict(slug) do nothing;

insert into public.posts
 (title,slug,content_html,excerpt,status,published_at,is_premium,category_id,
 featured_image_url,featured_image_alt,author_name,seo_title,seo_description,reading_time)
 values ($q$Best PPSSPP Settings for Mid-Range and High-End Android Phones$q$,'best-ppsspp-settings-mid-high-end-android',$q$<p>If your phone runs PSP games at full speed with the defaults, you can spend the spare power on picture quality. The trick is to raise quality in small steps and stop when the game stops being smooth.</p>

<h2>Core settings</h2>
<ul>
<li><strong>Backend:</strong> Vulkan is usually the best choice on modern phones. If a game glitches, test OpenGL.</li>
<li><strong>Rendering resolution:</strong> start at <strong>2x PSP</strong>. Going higher gives a sharper image, but very high values can cause stutter, heat and fast battery drain. For many games 2x is the sweet spot.</li>
<li><strong>Rendering mode:</strong> keep Buffered rendering. It is the accurate option and avoids missing shadows and effects.</li>
<li><strong>Hardware transform and software skinning:</strong> keep both on.</li>
</ul>

<h2>Make textures look better</h2>
<ul>
<li><strong>Anisotropic filtering:</strong> raises sharpness on surfaces seen at an angle, such as roads. Try 4x, then higher if the game stays smooth.</li>
<li><strong>Texture scaling:</strong> smooths low-resolution textures. A 2x level is a reasonable start, but it costs performance, so test it in a busy scene.</li>
<li><strong>Texture deposterize:</strong> helpful if upscaled textures show colour banding.</li>
<li><strong>Post-processing shaders:</strong> optional effects found under <strong>Settings &rarr; Graphics &rarr; Display layout &amp; effects</strong>. Add one only if you like the look, and remove it if the speed drops.</li>
</ul>

<h2>Things to avoid</h2>
<ul>
<li>Do not turn on <strong>Skip buffer effects</strong> unless you really need the speed; it can break shadows and sky effects.</li>
<li>If textures flicker, switch <strong>Lazy texture caching</strong> off.</li>
<li>Do not stack every option at once. Heat makes phones slow themselves down after a few minutes, so a setting that looks fine for one minute may stutter later.</li>
</ul>

<h2>Test properly</h2>
<ol>
<li>Turn on the FPS counter in the Graphics settings.</li>
<li>Play a demanding scene for five to ten minutes, not just the menu.</li>
<li>If the game drops below full speed, lower the last setting you raised.</li>
</ol>
<p>Create a per-game config (long-press the game, then Game Settings) so each game can have its own resolution. If a game struggles anyway, see <a href="/posts/fix-ppsspp-lag-stuttering-slow-speed">how to fix lag and stuttering</a>. For even sharper textures, try <a href="/posts/install-texture-packs-ppsspp">HD texture packs</a>.</p>
<p><em>Menu names can differ slightly between PPSSPP versions. If an option is in a different place on your phone, use the search or look in the nearby sections.</em></p>$q$,$q$Get sharper PSP graphics on a capable phone: Vulkan, higher rendering resolution, texture scaling and filtering without hurting smoothness.$q$,'draft',null,false,
 (select id from public.categories where slug='psp-ppsspp-games' and enabled limit 1),
 '/covers/psp-ppsspp-games.webp',$q$Best PPSSPP Settings for Mid-Range and High-End Android Phones$q$,'ELIAHTECH Gaming',$q$Best PPSSPP Settings for Mid-Range and High-End Phones$q$,$q$PPSSPP settings for stronger Android phones: Vulkan, rendering resolution, texture filtering and scaling for sharper graphics.$q$,2)
 on conflict(slug) do nothing;

insert into public.posts
 (title,slug,content_html,excerpt,status,published_at,is_premium,category_id,
 featured_image_url,featured_image_alt,author_name,seo_title,seo_description,reading_time)
 values ($q$How to Fix PPSSPP Lag, Stuttering and Slow Speed$q$,'fix-ppsspp-lag-stuttering-slow-speed',$q$<p>Lag in PPSSPP usually has one of a few causes: the phone is asked to draw too much, a setting does not suit that game, or the phone is overheating. Work through the list below in order and stop when the game runs well.</p>

<h2>1. Measure first</h2>
<p>Turn on the FPS counter in the Graphics settings. A full-speed PSP game normally shows 60 FPS, although some games target 30. If the number sits well below that, you have a performance problem. If it is fine but the game feels choppy, the cause is usually frame pacing or a background process.</p>

<h2>2. Lower the rendering resolution</h2>
<p>This is the most effective change. Set <strong>Rendering resolution</strong> to 1x PSP, then raise it only if the game runs well.</p>

<h2>3. Try the other backend</h2>
<p>Switch between Vulkan and OpenGL. One often runs a particular game much better than the other. After switching, restart the game. If speed stays poor, delete the contents of the <code>PSP/SYSTEM/CACHE</code> folder inside your Memory Stick folder. It is only cache and PPSSPP will build it again.</p>

<h2>4. Turn off the extras</h2>
<ul>
<li>Texture scaling</li>
<li>Anisotropic filtering</li>
<li>Post-processing shaders</li>
</ul>

<h2>5. Use the speed options</h2>
<ul>
<li>Enable <strong>Lazy texture caching</strong>.</li>
<li>Set <strong>Spline/Bezier curves quality</strong> to Low.</li>
<li>Try <strong>Fast memory</strong> in the System settings; turn it off if the game crashes.</li>
<li>Try a small <strong>Frameskip</strong> (1 or 2) for a game that still drags.</li>
<li>As a last resort, try <strong>Skip buffer effects</strong>, accepting that some effects may disappear.</li>
</ul>

<h2>6. Check your phone</h2>
<ul>
<li>Turn off battery saver and any performance-limiting mode.</li>
<li>Close background apps and let the phone cool down. Phones slow down when hot, so a game that starts smooth and then drops after ten minutes is usually overheating.</li>
<li>Take off thick cases and avoid charging while playing a heavy game.</li>
<li>Keep the game on internal storage if it loads slowly from a memory card.</li>
</ul>

<h2>7. Update and test</h2>
<p>Install the latest PPSSPP from an official source, because performance fixes arrive regularly. If one game is still slow, make a game-specific config rather than changing everything.</p>
<p>For a full set of recommended values, see <a href="/posts/best-ppsspp-settings-low-end-android">the low-end settings guide</a>. If the sound also crackles, read <a href="/posts/fix-ppsspp-sound-crackling-audio-lag">how to fix PPSSPP audio problems</a>.</p>
<p><em>Menu names can differ slightly between PPSSPP versions. If an option is in a different place on your phone, use the search or look in the nearby sections.</em></p>$q$,$q$A step-by-step checklist to fix slow, laggy or stuttering PPSSPP games on Android, starting with the changes that help most.$q$,'draft',null,false,
 (select id from public.categories where slug='psp-ppsspp-games' and enabled limit 1),
 '/covers/psp-ppsspp-games.webp',$q$How to Fix PPSSPP Lag, Stuttering and Slow Speed$q$,'ELIAHTECH Gaming',$q$How to Fix PPSSPP Lag, Stuttering and Slow Speed$q$,$q$Fix PPSSPP lag and stuttering on Android with this checklist: resolution, backend, speed hacks, heat, storage and more.$q$,2)
 on conflict(slug) do nothing;

insert into public.posts
 (title,slug,content_html,excerpt,status,published_at,is_premium,category_id,
 featured_image_url,featured_image_alt,author_name,seo_title,seo_description,reading_time)
 values ($q$How to Fix PPSSPP Black Screen, Crashes and Games That Won't Load$q$,'fix-ppsspp-black-screen-crash-game-wont-load',$q$<p>A black screen, a crash at startup or a message saying the game cannot be loaded almost always comes from the game file, the graphics backend or a risky setting. Check these in order.</p>

<h2>1. Check the game file</h2>
<ul>
<li><strong>Is it still an archive?</strong> PPSSPP cannot play a game from inside a <code>.zip</code>, <code>.7z</code> or <code>.rar</code>. Extract it first.</li>
<li><strong>Is the download complete?</strong> An interrupted download gives a file that is too small. Compare the size with what the source says, and download again if it differs.</li>
<li><strong>Is the file damaged?</strong> Try another copy, or move the file to internal storage and test again.</li>
<li><strong>Is it the right file?</strong> Some mods and patches only work on one specific region or version of the original game. Follow the author's instructions.</li>
</ul>

<h2>2. Switch the graphics backend</h2>
<p>Go to Settings &rarr; Graphics and change the backend between Vulkan and OpenGL, then start the game again. Many black screens are caused by a backend that does not suit your phone's driver or that game.</p>

<h2>3. Turn off risky options</h2>
<ul>
<li>Turn off <strong>Fast memory (unstable)</strong> in the System settings.</li>
<li>Turn off <strong>Skip buffer effects</strong> and other speed hacks.</li>
<li>Turn off <strong>Replace textures</strong> and <strong>Enable cheats</strong> to see if one of them causes the crash.</li>
</ul>

<h2>4. Reset the game's own settings</h2>
<p>If you made a game-specific config, open it from the game's settings page and delete it so the game goes back to the global defaults.</p>

<h2>5. Check folder access</h2>
<p>On Android 11 and newer, PPSSPP only sees the folders you gave it access to. If games vanished or saves seem missing after an update or storage cleanup, open Settings &rarr; System and choose your Memory Stick folder again, then re-add your games folder.</p>

<h2>6. Update or reinstall PPSSPP</h2>
<p>Install the latest version from an official source. Before you uninstall anything, back up your Memory Stick folder (see <a href="/posts/ppsspp-save-data-save-states-backup-transfer">how to back up PPSSPP saves</a>), because that folder holds your saves.</p>

<h2>Still stuck?</h2>
<p>Note exactly what happens: black screen with sound, crash on the logo, or an error message. Those details point to the cause. Also confirm that the phone has free storage and is not running in a power-saving mode. If the game starts but runs badly, go to <a href="/posts/fix-ppsspp-lag-stuttering-slow-speed">the lag and stuttering guide</a>.</p>
<p><em>Menu names can differ slightly between PPSSPP versions. If an option is in a different place on your phone, use the search or look in the nearby sections.</em></p>$q$,$q$Fix a PPSSPP black screen, instant crash or a game that fails to load by checking the file, backend, folder access and settings.$q$,'draft',null,false,
 (select id from public.categories where slug='psp-ppsspp-games' and enabled limit 1),
 '/covers/psp-ppsspp-games.webp',$q$How to Fix PPSSPP Black Screen, Crashes and Games That Won't Load$q$,'ELIAHTECH Gaming',$q$Fix PPSSPP Black Screen, Crashes and Load Errors$q$,$q$Troubleshoot PPSSPP black screens, crashes and games that will not load: file problems, backend, Fast memory and folder access.$q$,3)
 on conflict(slug) do nothing;

insert into public.posts
 (title,slug,content_html,excerpt,status,published_at,is_premium,category_id,
 featured_image_url,featured_image_alt,author_name,seo_title,seo_description,reading_time)
 values ($q$How to Fix PPSSPP Sound Crackling and Audio Lag$q$,'fix-ppsspp-sound-crackling-audio-lag',$q$<p>Crackling or stuttering sound in PPSSPP is usually a symptom, not the real problem. When the emulator cannot keep up with the game, the audio runs out of data and pops. So the first fix is almost always speed.</p>

<h2>1. Fix performance first</h2>
<p>If the game also lags, the sound will crackle. Lower the rendering resolution to 1x PSP and follow <a href="/posts/fix-ppsspp-lag-stuttering-slow-speed">the lag and stuttering checklist</a>. When the game runs at full speed, the crackling often disappears on its own.</p>

<h2>2. Check the audio settings</h2>
<ol>
<li>Open <strong>Settings &rarr; Audio</strong>.</li>
<li>Make sure <strong>Enable sound</strong> is on and the volume is not at zero.</li>
<li>If you see an <strong>Audio latency</strong> option, raise it from Low to Medium or High. A larger buffer reduces crackling but adds a little delay.</li>
</ol>

<h2>3. Check your phone</h2>
<ul>
<li>Turn off battery saver; it can limit the processor and starve the audio.</li>
<li>Close other apps that play or process sound, such as music apps and screen recorders.</li>
<li>Let the phone cool down if it is hot.</li>
</ul>

<h2>4. Bluetooth headphones</h2>
<p>Bluetooth adds its own delay, so sound can arrive noticeably after the picture. Try wired headphones or the phone speaker to confirm. If wired sound is in sync, the delay comes from the Bluetooth connection, not from PPSSPP.</p>

<h2>5. Try a different graphics backend</h2>
<p>Switching between Vulkan and OpenGL changes how much work the phone does, and for some phones and games that is enough to stop the audio breaking up.</p>

<h2>6. No sound at all</h2>
<ul>
<li>Check that the phone is not on silent or do-not-disturb mode, and that the media volume is up.</li>
<li>Test a different game. If only one game is silent, it may be a problem with that game file or mod.</li>
<li>Restart PPSSPP, then the phone.</li>
</ul>
<p>If the problem is only in one game, make a game-specific config and test settings there so your other games are not affected. See <a href="/posts/best-ppsspp-settings-low-end-android">the low-end settings guide</a> for a good starting point.</p>
<p><em>Menu names can differ slightly between PPSSPP versions. If an option is in a different place on your phone, use the search or look in the nearby sections.</em></p>$q$,$q$Stop crackling, popping, delayed or missing sound in PPSSPP by fixing speed first, then adjusting audio settings and headphones.$q$,'draft',null,false,
 (select id from public.categories where slug='psp-ppsspp-games' and enabled limit 1),
 '/covers/psp-ppsspp-games.webp',$q$How to Fix PPSSPP Sound Crackling and Audio Lag$q$,'ELIAHTECH Gaming',$q$How to Fix PPSSPP Sound Crackling and Audio Lag$q$,$q$Fix PPSSPP sound crackling, popping, delay and no-audio problems on Android: performance, audio latency and Bluetooth tips.$q$,2)
 on conflict(slug) do nothing;

insert into public.posts
 (title,slug,content_html,excerpt,status,published_at,is_premium,category_id,
 featured_image_url,featured_image_alt,author_name,seo_title,seo_description,reading_time)
 values ($q$How to Set Up PPSSPP Touch Controls and Bluetooth Controllers$q$,'ppsspp-controls-onscreen-bluetooth-controller',$q$<p>PPSSPP gives you two ways to play on a phone: on-screen touch buttons or a physical controller. You can adjust both to fit your hands and the game.</p>

<h2>Customise the touch controls</h2>
<ol>
<li>Open <strong>Settings &rarr; Controls</strong>.</li>
<li>Find the on-screen touch control options and choose to edit the layout.</li>
<li>Drag buttons where you want them and use the size controls to make them bigger or smaller.</li>
<li>Save your layout and test it in a game.</li>
</ol>
<p>Useful tips:</p>
<ul>
<li>Put the D-pad and analog stick where your thumbs rest naturally, not at the very edge of the screen.</li>
<li>Lower the button opacity so the buttons do not hide the picture.</li>
<li>If a game needs two buttons at once, use the custom or combo buttons if your version offers them.</li>
<li>Rotate the phone to landscape and use full screen so the buttons sit outside the game area where possible.</li>
</ul>

<h2>Connect a Bluetooth controller</h2>
<ol>
<li>Put the controller in pairing mode.</li>
<li>Pair it first in Android's own <strong>Bluetooth settings</strong>, not inside PPSSPP.</li>
<li>Open PPSSPP and press a button on the controller. Many pads work straight away.</li>
<li>Start a game and check that the buttons behave correctly.</li>
</ol>

<h2>Map the buttons yourself</h2>
<p>If a button does the wrong thing, open <strong>Settings &rarr; Controls &rarr; Control mapping</strong>. Tap a PSP button, then press the button on your controller that should trigger it. Repeat for each button, and test the analog stick in a game that uses it. If your controller has an auto-configure option, try that first.</p>

<h2>Troubleshooting</h2>
<ul>
<li><strong>Controller not detected:</strong> forget the device in Android Bluetooth settings, pair it again and restart PPSSPP.</li>
<li><strong>Stick drifts or is too sensitive:</strong> adjust the analog dead zone and sensitivity in the Controls settings.</li>
<li><strong>Touch buttons still show:</strong> turn off the on-screen touch controls in the Controls settings when you use a pad.</li>
<li><strong>Input feels delayed:</strong> fix performance first, because lag in the game also feels like lag in the controls. See <a href="/posts/fix-ppsspp-lag-stuttering-slow-speed">the lag guide</a>.</li>
</ul>
<p>New to PPSSPP? Start with <a href="/posts/install-ppsspp-android-run-first-psp-game">how to install it and run your first game</a>.</p>
<p><em>Menu names can differ slightly between PPSSPP versions. If an option is in a different place on your phone, use the search or look in the nearby sections.</em></p>$q$,$q$Customise PPSSPP on-screen buttons, adjust size and opacity, and connect a Bluetooth gamepad on Android.$q$,'draft',null,false,
 (select id from public.categories where slug='psp-ppsspp-games' and enabled limit 1),
 '/covers/psp-ppsspp-games.webp',$q$How to Set Up PPSSPP Touch Controls and Bluetooth Controllers$q$,'ELIAHTECH Gaming',$q$PPSSPP Touch Controls and Bluetooth Controller Setup$q$,$q$Set up PPSSPP on-screen touch controls and connect a Bluetooth controller on Android, with mapping and troubleshooting tips.$q$,2)
 on conflict(slug) do nothing;

insert into public.posts
 (title,slug,content_html,excerpt,status,published_at,is_premium,category_id,
 featured_image_url,featured_image_alt,author_name,seo_title,seo_description,reading_time)
 values ($q$How to Use Cheats in PPSSPP (cheat.db and Manual Codes)$q$,'how-to-use-cheats-in-ppsspp',$q$<p>PPSSPP can apply cheat codes, including speed or frame-rate patches. You need to switch cheats on, put a cheat file in the right folder and then pick the codes inside the game.</p>

<h2>Step 1: Enable cheats</h2>
<p>Open <strong>Settings &rarr; System</strong> and tick <strong>Enable cheats</strong>. Without this, the Cheats menu will not work.</p>

<h2>Step 2: Find your Cheats folder</h2>
<p>Open <strong>Settings &rarr; System</strong> and use the option to show your Memory Stick folder. Inside it, open <code>PSP</code>, then <code>Cheats</code>. If there is no <code>Cheats</code> folder, create one, using exactly that name.</p>

<h2>Step 3: Add the cheat database</h2>
<p>A <code>cheat.db</code> file is a collection of codes for many games. Put it inside <code>PSP/Cheats</code>, then restart PPSSPP. Download it from a source you trust; community-made databases exist, and the quality varies from game to game.</p>

<h2>Step 4: Import and turn on codes</h2>
<ol>
<li>Start your game.</li>
<li>Open the PPSSPP pause menu.</li>
<li>Choose <strong>Cheats</strong>, then <strong>Import from cheat.db</strong>.</li>
<li>Tick the cheats you want and go back to the game.</li>
</ol>
<p>If the list is empty, the database may have no codes for your exact game or version.</p>

<h2>Adding a code by hand</h2>
<p>You can also keep codes for one game in its own <code>.ini</code> file inside <code>PSP/Cheats</code>. The file is named after the game ID, for example <code>ULUS10177.ini</code>. The ID is shown in PPSSPP for each game and looks like four letters followed by five numbers. After adding the file, reopen the game and enable the code from the Cheats menu.</p>

<h2>Tips and warnings</h2>
<ul>
<li>Codes are made for a specific game and region. A code for another version can crash the game or do nothing.</li>
<li>Make a <a href="/posts/ppsspp-save-data-save-states-backup-transfer">save and a backup</a> before you try new codes, because some can corrupt progress.</li>
<li>Turn on one cheat at a time so you know which one caused a problem.</li>
<li>Cheats may be disabled in some modes, and enabling them can affect achievements-style features in other apps, so keep them to single-player games.</li>
</ul>
<p>If the game crashes after enabling a cheat, untick it, or turn off <strong>Enable cheats</strong> altogether and read <a href="/posts/fix-ppsspp-black-screen-crash-game-wont-load">the crash troubleshooting guide</a>.</p>
<p><em>Menu names can differ slightly between PPSSPP versions. If an option is in a different place on your phone, use the search or look in the nearby sections.</em></p>$q$,$q$Turn on cheats in PPSSPP, place the cheat.db file in the right folder and import or add codes for your game.$q$,'draft',null,false,
 (select id from public.categories where slug='psp-ppsspp-games' and enabled limit 1),
 '/covers/psp-ppsspp-games.webp',$q$How to Use Cheats in PPSSPP (cheat.db and Manual Codes)$q$,'ELIAHTECH Gaming',$q$How to Use Cheats in PPSSPP: cheat.db and Codes$q$,$q$Learn how to enable cheats in PPSSPP, add the cheat.db file to the Cheats folder and import or write codes for a game.$q$,2)
 on conflict(slug) do nothing;

insert into public.posts
 (title,slug,content_html,excerpt,status,published_at,is_premium,category_id,
 featured_image_url,featured_image_alt,author_name,seo_title,seo_description,reading_time)
 values ($q$PPSSPP Save Data and Save States: Where They Are and How to Back Them Up$q$,'ppsspp-save-data-save-states-backup-transfer',$q$<p>Losing hours of progress is avoidable if you know where PPSSPP keeps your saves. Everything lives inside your Memory Stick folder.</p>

<h2>In-game saves and save states are different</h2>
<ul>
<li><strong>In-game saves</strong> are what the real PSP created. They are stored in <code>PSP/SAVEDATA</code> and work like saves on the original console.</li>
<li><strong>Save states</strong> are snapshots of the whole emulator at one moment. They are stored in <code>PSP/PPSSPP_STATE</code>, and they may not load after a PPSSPP update or on another platform.</li>
</ul>
<p>Use normal in-game saves as your main progress, and treat save states as a convenience on top.</p>

<h2>Find your Memory Stick folder</h2>
<p>Open <strong>Settings &rarr; System</strong> and use the option to show the Memory Stick folder. On Android 10 and older it is usually a <code>PSP</code> folder in your storage. On Android 11 and newer it is the folder you created when you set up PPSSPP. Inside it, open the <code>PSP</code> folder to see <code>SAVEDATA</code>, <code>PPSSPP_STATE</code>, <code>Cheats</code>, <code>TEXTURES</code> and <code>GAME</code>.</p>

<h2>Back up your progress</h2>
<ol>
<li>Open your Memory Stick folder in a file manager.</li>
<li>Copy <code>PSP/SAVEDATA</code> to a safe place such as cloud storage, a PC or another phone.</li>
<li>Also copy <code>PSP/PPSSPP_STATE</code> if you use save states, and <code>Cheats</code> and <code>TEXTURES</code> if you added them.</li>
<li>Do this before you update, reinstall, factory-reset or change phones.</li>
</ol>

<h2>Move saves to a new phone or a PC</h2>
<ol>
<li>Install PPSSPP on the new device and set up its Memory Stick folder.</li>
<li>Close PPSSPP.</li>
<li>Copy the <code>SAVEDATA</code> folder into the new <code>PSP</code> folder, keeping the folder names exactly as they are. The name <code>SAVEDATA</code> must stay in capitals.</li>
<li>Open PPSSPP and load the game. The save should appear in the game's load menu.</li>
</ol>
<p>Be careful with the <code>SYSTEM</code> folder: it holds PPSSPP's settings, so copying it over a new install replaces your new settings.</p>

<h2>Common problems</h2>
<ul>
<li><strong>Save does not show up:</strong> the game region or version must match the one that made the save, and the folder must be in <code>PSP/SAVEDATA</code>.</li>
<li><strong>Save states will not load:</strong> they often break between PPSSPP versions. Load the in-game save instead.</li>
<li><strong>Saves vanished after an update:</strong> on Android 11 and newer, choose your original Memory Stick folder again in Settings &rarr; System.</li>
</ul>
<p>If you are setting up for the first time, read <a href="/posts/install-ppsspp-android-run-first-psp-game">the installation guide</a>.</p>
<p><em>Menu names can differ slightly between PPSSPP versions. If an option is in a different place on your phone, use the search or look in the nearby sections.</em></p>$q$,$q$Find your PPSSPP save data and save states, back them up and move them to a new phone or a PC without losing progress.$q$,'draft',null,false,
 (select id from public.categories where slug='psp-ppsspp-games' and enabled limit 1),
 '/covers/psp-ppsspp-games.webp',$q$PPSSPP Save Data and Save States: Where They Are and How to Back Them Up$q$,'ELIAHTECH Gaming',$q$PPSSPP Save Data and Save States: Find and Back Up$q$,$q$Where PPSSPP stores saves and save states, how to back them up and how to move your progress to a new phone or PC.$q$,3)
 on conflict(slug) do nothing;

insert into public.posts
 (title,slug,content_html,excerpt,status,published_at,is_premium,category_id,
 featured_image_url,featured_image_alt,author_name,seo_title,seo_description,reading_time)
 values ($q$How to Install HD Texture Packs in PPSSPP$q$,'install-texture-packs-ppsspp',$q$<p>A texture pack replaces the original low-resolution images in a PSP game with sharper ones, which can make a big difference at higher rendering resolutions. The pack must be made for your exact game and region.</p>

<h2>What you need</h2>
<ul>
<li>A texture pack for your game, with a <code>textures.ini</code> file and folders of images.</li>
<li>Access to your Memory Stick folder.</li>
<li>A phone with enough spare performance. Large packs use more memory.</li>
</ul>

<h2>Step 1: Find the game ID</h2>
<p>Every PSP game has an ID made of four letters and five numbers, for example <code>ULUS10041</code>. PPSSPP shows it for each game. The texture pack's folder must use the same ID as your copy of the game, so a pack for another region will not work.</p>

<h2>Step 2: Copy the pack to the right folder</h2>
<ol>
<li>Extract the downloaded pack first.</li>
<li>Open your Memory Stick folder, then <code>PSP</code>.</li>
<li>Create a <code>TEXTURES</code> folder if it does not exist.</li>
<li>Inside <code>TEXTURES</code>, create a folder named with your game ID.</li>
<li>Put the pack's <code>textures.ini</code> and its folders directly in that game ID folder.</li>
</ol>
<p>The result should look like <code>PSP/TEXTURES/ULUS10041/textures.ini</code>. A common mistake is an extra folder in between, such as <code>ULUS10041/PackName/textures.ini</code>, which makes PPSSPP ignore the pack.</p>

<h2>Step 3: Turn on texture replacement</h2>
<p>Open <strong>Settings &rarr; Tools &rarr; Developer tools</strong>, find the Texture replacement section and tick <strong>Replace textures</strong>. Some packs also advise turning anisotropic filtering off in the Graphics settings, so read the pack's instructions.</p>

<h2>Step 4: Test it</h2>
<p>Start the game and look at menus and characters. The first load may be slower while PPSSPP reads the new images.</p>

<h2>If nothing changes</h2>
<ul>
<li>Check that the game ID folder name matches your game exactly.</li>
<li>Check that <code>textures.ini</code> is directly inside that folder.</li>
<li>Make sure <strong>Replace textures</strong> is ticked and restart the game.</li>
<li>Confirm that the pack was made for your region and version.</li>
</ul>

<h2>If the game slows down</h2>
<p>High-resolution textures need more memory. Lower the rendering resolution, turn off texture scaling (the pack already improves the textures), or switch to a lighter pack. See <a href="/posts/fix-ppsspp-lag-stuttering-slow-speed">the lag guide</a> for more.</p>
<p>Respect the pack author's credits and licence when you share or re-upload their work. To keep your texture folder safe, include it in your <a href="/posts/ppsspp-save-data-save-states-backup-transfer">backups</a>.</p>
<p><em>Menu names can differ slightly between PPSSPP versions. If an option is in a different place on your phone, use the search or look in the nearby sections.</em></p>$q$,$q$Add HD texture packs to PPSSPP: find the game ID, copy the pack into PSP/TEXTURES and switch on Replace textures.$q$,'draft',null,false,
 (select id from public.categories where slug='psp-ppsspp-games' and enabled limit 1),
 '/covers/psp-ppsspp-games.webp',$q$How to Install HD Texture Packs in PPSSPP$q$,'ELIAHTECH Gaming',$q$How to Install HD Texture Packs in PPSSPP$q$,$q$Install HD texture packs in PPSSPP: put the pack in PSP/TEXTURES, match the game ID and enable Replace textures.$q$,3)
 on conflict(slug) do nothing;

commit;

-- Shows what was created. status = draft means it is waiting for your review.
select title, slug, status, reading_time, '/posts/'||slug as website_path
from public.posts
where slug in ('install-ppsspp-android-run-first-psp-game','best-ppsspp-settings-low-end-android','best-ppsspp-settings-mid-high-end-android','fix-ppsspp-lag-stuttering-slow-speed','fix-ppsspp-black-screen-crash-game-wont-load','fix-ppsspp-sound-crackling-audio-lag','ppsspp-controls-onscreen-bluetooth-controller','how-to-use-cheats-in-ppsspp','ppsspp-save-data-save-states-backup-transfer','install-texture-packs-ppsspp')
order by title;

-- TO PUBLISH ALL TEN (only after you have read them): remove the two dashes at the start of the
-- next three lines, then run just those lines.
-- update public.posts set status = 'published', published_at = now()
-- where slug in ('install-ppsspp-android-run-first-psp-game','best-ppsspp-settings-low-end-android','best-ppsspp-settings-mid-high-end-android','fix-ppsspp-lag-stuttering-slow-speed','fix-ppsspp-black-screen-crash-game-wont-load','fix-ppsspp-sound-crackling-audio-lag','ppsspp-controls-onscreen-bluetooth-controller','how-to-use-cheats-in-ppsspp','ppsspp-save-data-save-states-backup-transfer','install-texture-packs-ppsspp')
--   and status = 'draft';
