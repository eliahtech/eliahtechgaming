// Add up to five local image entries to each category. Captions are HTML text, never embedded in images.
export const SLIDE_INTERVAL = 3000;
export const SLIDE_EFFECTS = ['fade', 'pan', 'rise', 'zoom', 'reveal'];
export const SLIDE_CATEGORIES = [
  { key:'football', slug:'football-games-updates', label:'Football Games & Updates', slides:[
    {title:'Celebrate every winning moment.',description:'Explore football updates, formations and practical match-day tactics.',alt:'Football players celebrating a goal in a floodlit stadium'},
    {title:'Build your next winning move.',description:'Learn attacking patterns, defending techniques and smarter formations.',alt:'Football forward striking a volley in a bright stadium'}
  ]},
  { key:'psp', slug:'psp-ppsspp-games', label:'PSP & PPSSPP Games and Mods', slides:[
    {title:'Big adventures. Portable play.',description:'Find PPSSPP guides, game settings and handheld gaming tips.',alt:'Portable gaming console displaying a rally racing scene'},
    {title:'Make the most of PPSSPP.',description:'Set up your emulator and find settings that suit your device.',alt:'Hands holding a portable console displaying a football match'}
  ]},
  { key:'android', slug:'android-games-mods', label:'Android Games & Mods', slides:[
    {title:'Take your gaming anywhere.',description:'Discover Android gaming guides and practical device setup advice.',alt:'Android-style phone and controller displaying a racing game'},
    {title:'Your phone. A world of play.',description:'Explore mobile adventures, compatibility tips and helpful walkthroughs.',alt:'Hands holding a phone displaying a colorful adventure game'}
  ]},
  { key:'installation', slug:'game-installation-setup', label:'Game Installation & Setup Guides', slides:[
    {title:'Get set up with confidence.',description:'Follow clear installation steps for games, files and emulator settings.',alt:'Handheld console, smartphone and storage accessories on a desk'},
    {title:'From download to ready to play.',description:'Find folder guidance, setup instructions and answers to common errors.',alt:'Hands connecting gaming devices beside storage accessories'}
  ]},
  { key:'graphics', slug:'game-graphics-textures-mods', label:'Game Graphics, Textures & Mods', slides:[
    {title:'Bring every detail to life.',description:'Explore texture setup, graphics guides and original visual resources.',alt:'Gaming display showing a detailed football scene and texture samples'},
    {title:'Give your games a fresh look.',description:'Learn how graphics settings and textures change your gaming experience.',alt:'Racing car transitioning from a wireframe into detailed surfaces'}
  ]},
  { key:'tech', slug:'tech-tips-tutorials', label:'Tech Tips & Tutorials', slides:[
    {title:'Make your setup work smarter.',description:'Practical tips for gaming devices, performance and everyday troubleshooting.',alt:'Gaming laptop, smartphone and controller in a blue-lit workspace'},
    {title:'Find the fix. Keep playing.',description:'Work through common device issues with clear, practical tech guides.',alt:'Hands adjusting a controller beside a laptop and gaming tools'}
  ]},
  { key:'ai', slug:'ai-tools-tutorials', label:'AI Tools, Tips & Tutorials', slides:[
    {title:'Create more with clever tools.',description:'Explore AI ideas for gaming artwork, content and creator workflows.',alt:'Glowing AI neural orb above a gaming controller'},
    {title:'Turn gaming ideas into content.',description:'Learn creative workflows for gaming posters, videos and tutorials.',alt:'Gaming creator workstation with football artwork on a monitor'}
  ]}
];
// Round-robin ordering shows every category before its second image.
export const SLIDES = Array.from({length:5},(_,round)=>SLIDE_CATEGORIES.flatMap(category=>{
  const slide=category.slides[round];return slide?[{...slide,id:`${category.key}-${round+1}`,category:category.label,categorySlug:category.slug,href:`/category/${category.slug}`,image:`/slides/${category.key}-${round+1}.webp`,mobileImage:`/slides/${category.key}-${round+1}-mobile.webp`}]:[];
})).flat();
