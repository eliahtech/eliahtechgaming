// Declarative definitions of what admins may create and edit. `fields` is the write whitelist.
export const POST_STATUSES = ['draft', 'published', 'archived'];
export const ACCENTS = ['violet', 'cyan', 'orange', 'pink'];

export const RESOURCES = {
  games:{table:'game_hubs',audit:'game',slugFrom:'name',search:['name','slug'],order:'sort_order.asc,name.asc',touchUpdatedAt:true,listSelect:'id,slug,name,summary,cover_image_url,platforms,enabled,sort_order',fields:{name:{required:true,min:2,max:120},slug:{type:'slug',max:80},summary:{type:'string',required:true,min:2,max:1000},cover_image_url:{type:'image',nullable:true,max:2000},platforms:{type:'strings',maxItems:5,maxLen:20},enabled:{type:'bool'},sort_order:{type:'int',max:10000}}},
  ads: {
    table: 'ad_placements', audit: 'ads', search: ['name','platform'], order: 'sort_order.asc', touchUpdatedAt: true,
    listSelect: 'id,name,platform,placement,enabled,device,sort_order', detailSelect: '*',
    fields: { name: {required:true,min:2,max:120}, platform: {max:80}, placement: {type:'enum',values:['header','body','footer','sidebar','auto'],required:true}, code: {type:'string',max:50000}, enabled:{type:'bool'},device:{type:'enum',values:['both','desktop','mobile']},paragraph:{type:'int',min:1,max:100},starts_at:{type:'datetime',nullable:true},ends_at:{type:'datetime',nullable:true},sort_order:{type:'int',max:10000} }
  },
  tickets: {table:'support_tickets',audit:'support',search:['subject'],order:'created_at.desc',listSelect:'id,subject,priority,status,created_at',detailSelect:'*',fields:{status:{type:'enum',values:['open','in_progress','resolved']},admin_reply:{type:'string',max:8000,nullable:true}}},
  reports: {table:'content_reports',audit:'report',search:['message'],order:'created_at.desc',listSelect:'id,message,status,created_at',detailSelect:'*',fields:{status:{type:'enum',values:['open','resolved','dismissed']}}},
  comments: {table:'post_comments',audit:'comment',search:['body','display_name'],order:'created_at.desc',listSelect:'id,display_name,body,status,created_at',detailSelect:'*',fields:{status:{type:'enum',values:['pending','approved','rejected']}}},
  requests: {table:'tutorial_requests',audit:'request',search:['title'],order:'created_at.desc',listSelect:'id,title,description,status,created_at',detailSelect:'*',fields:{status:{type:'enum',values:['pending','open','planned','completed','rejected']}}},
  categories: {
    table: 'categories', audit: 'category', slugFrom: 'name', search: ['name', 'slug'], order: 'sort_order.asc,name.asc',
    listSelect: 'id,slug,name,description,icon,color,enabled,sort_order',
    fields: {
      name: { required: true, min: 2, max: 80 }, slug: { type: 'slug', max: 80 }, description: { type: 'string', max: 500, nullable: true },
      icon: { type: 'icon', nullable: true }, color: { type: 'color', nullable: true }, enabled: { type: 'bool' }, sort_order: { type: 'int', max: 10000 },
    },
  },
  tags: {
    table: 'tags', audit: 'tag', slugFrom: 'name', search: ['name', 'slug'], order: 'name.asc',
    listSelect: 'id,slug,name',
    fields: { name: { required: true, min: 2, max: 40 }, slug: { type: 'slug', max: 80 } },
  },
  services: {
    table: 'services', audit: 'service', slugFrom: 'title', search: ['title', 'slug'], order: 'sort_order.asc,title.asc',
    listSelect: 'id,slug,title,description,image_url,icon,features,price,currency,accent,action_text,action_url,seo_title,seo_description,is_active,sort_order',
    fields: {
      title: { required: true, min: 2, max: 120 }, slug: { type: 'slug', max: 80 }, description: { required: true, min: 2, max: 1000 },
      image_url: { type: 'image', nullable: true }, icon: { type: 'icon', nullable: true }, features: { type: 'strings', maxItems: 10, maxLen: 120 },
      price: { type: 'string', max: 40, nullable: true }, currency: { type: 'string', max: 8, nullable: true }, accent: { type: 'enum', values: ACCENTS },
      action_text: { type: 'string', max: 40, nullable: true }, action_url: { type: 'url', relative: true, nullable: true },
      seo_title: { type: 'string', max: 120, nullable: true }, seo_description: { type: 'string', max: 320, nullable: true },
      is_active: { type: 'bool' }, sort_order: { type: 'int', max: 10000 },
    },
  },
  plans: {
    table: 'premium_plans', audit: 'plan', search: ['name', 'code'], order: 'sort_order.asc,created_at.asc', touchUpdatedAt: true,
    listSelect: 'id,code,name,description,duration_days,prices,enabled,sort_order',
    fields: {
      code: { type: 'slug', required: true, max: 40 }, name: { required: true, min: 2, max: 80 }, description: { type: 'string', max: 300, nullable: true },
      duration_days: { type: 'int', min: 1, max: 3660, required: true }, prices: { type: 'prices' }, enabled: { type: 'bool' }, sort_order: { type: 'int', max: 10000 },
    },
  },
  guides: {
    table: 'installation_guides', audit: 'installation_guide', slugFrom: 'title', search: ['title', 'slug'], order: 'title.asc',
    listSelect: 'id,slug,title,enabled,updated_at', detailSelect: 'id,slug,title,content_html,enabled,updated_at', touchUpdatedAt: true,
    fields: { title: { required: true, min: 2, max: 150 }, slug: { type: 'slug', max: 80 }, content_html: { type: 'html', required: true }, enabled: { type: 'bool' } },
  },
  'social-links': {
    table: 'social_links', audit: 'social_link', search: ['platform'], order: 'sort_order.asc,platform.asc',
    listSelect: 'id,platform,url,icon,enabled,sort_order',
    fields: {
      platform: { required: true, min: 2, max: 40 }, url: { type: 'url', required: true, max: 300 }, icon: { type: 'icon', nullable: true },
      enabled: { type: 'bool' }, sort_order: { type: 'int', max: 10000 },
    },
  },
  posts: {
    table: 'posts', audit: 'post', slugFrom: 'title', search: ['title', 'slug'], order: 'updated_at.desc', touchUpdatedAt: true, filters: { status: POST_STATUSES },
    listSelect: 'id,slug,title,status,published_at,featured,is_premium,featured_image_url,updated_at,categories(name)',
    detailSelect: 'id,slug,title,excerpt,content_html,status,published_at,featured,is_premium,category_id,installation_guide_id,featured_image_url,featured_image_alt,seo_title,seo_description,seo_keywords,canonical_url,og_image,author_name,reading_time,ads_disabled,updated_at,game_id,content_type,platform,min_ram_gb,storage_mb,android_min_version,emulator_version,tested_devices,last_tested_at,reviewed_at,compatibility_notes,change_summary,post_tags(tags(name))',
    fields: {
      game_id:{type:'uuid',nullable:true},content_type:{type:'enum',values:['guide','installation','settings','textures','update','troubleshooting']},platform:{type:'enum',values:['android','ppsspp','pc','console','other'],nullable:true},min_ram_gb:{type:'decimal',min:.25,max:128,nullable:true},storage_mb:{type:'int',min:1,max:2000000,nullable:true},android_min_version:{type:'string',max:40,nullable:true},emulator_version:{type:'string',max:80,nullable:true},tested_devices:{type:'strings',maxItems:20,maxLen:120},last_tested_at:{type:'datetime',nullable:true},reviewed_at:{type:'datetime',nullable:true},compatibility_notes:{type:'string',max:1000,nullable:true},change_summary:{type:'string',min:3,max:500,nullable:true},
      title: { required: true, min: 2, max: 200 }, slug: { type: 'slug', max: 80 }, excerpt: { type: 'string', max: 500, nullable: true },
      content_html: { type: 'html', max: 2_000_000 }, status: { type: 'enum', values: POST_STATUSES }, published_at: { type: 'datetime', nullable: true },
      ads_disabled: {type:'bool'}, featured: { type: 'bool' }, is_premium: { type: 'bool' }, category_id: { type: 'uuid', nullable: true }, installation_guide_id: { type: 'uuid', nullable: true },
      featured_image_url: { type: 'image', nullable: true, max: 2000 }, featured_image_alt: { type: 'string', max: 200, nullable: true },
      seo_title: { type: 'string', max: 120, nullable: true }, seo_description: { type: 'string', max: 320, nullable: true },
      seo_keywords: { type: 'strings', maxItems: 20, maxLen: 60 }, canonical_url: { type: 'url', nullable: true, max: 500 }, og_image: { type: 'image', nullable: true, max: 2000 },
      author_name: { type: 'string', max: 80, nullable: true },
    },
  },
};
