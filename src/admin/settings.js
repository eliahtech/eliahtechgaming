import {parsePromotions}from'../promotions.js';
// Validation for admin-editable public settings documents (homepage, premium and site identity).
import { AppError } from '../errors.js';
import { validateFields, SLUG_RE } from './fields.js';

export const SECTION_KEYS = ['featured', 'latest', 'categories', 'services', 'youtube', 'newsletter', 'ai', 'premium'];
const homepageFields = {
  hero_title: { required: true, min: 2, max: 120 }, hero_description: { required: true, min: 2, max: 400 },
  cta_label: { type: 'string', max: 40 }, cta_url: { type: 'url', relative: true, max: 200 },
  secondary_cta_label: { type: 'string', max: 40 }, secondary_cta_url: { type: 'url', relative: true, max: 200 },
  latest_post_count: { type: 'int', min: 1, max: 24 },
};
const sectionFields = { enabled: { type: 'bool' }, eyebrow: { type: 'string', max: 40, nullable: true }, title: { type: 'string', max: 120, nullable: true }, description: { type: 'string', max: 300, nullable: true } };

function parseHomepage(body) {
  const value = validateFields(homepageFields, body);
  const slug = body.featured_post_slug;
  if (slug !== undefined && slug !== null && slug !== '' && !(typeof slug === 'string' && SLUG_RE.test(slug))) throw new AppError('VALIDATION_ERROR', 'Some fields are invalid.', 422, { fields: { featured_post_slug: 'Use a post slug.' } });
  value.featured_post_slug = slug || null;
  if (!Array.isArray(body.sections) || body.sections.length > SECTION_KEYS.length) throw new AppError('VALIDATION_ERROR', 'Some fields are invalid.', 422, { fields: { sections: 'Provide the homepage sections list.' } });
  const seen = new Set();
  value.sections = body.sections.map((section, i) => {
    if (!SECTION_KEYS.includes(section?.key) || seen.has(section.key)) throw new AppError('VALIDATION_ERROR', 'Some fields are invalid.', 422, { fields: { sections: `Section ${i + 1} has an unknown or duplicate key.` } });
    seen.add(section.key);
    const out = { key: section.key, ...validateFields(sectionFields, section) };
    if (section.key === 'youtube') {
      const id = section.video_id;
      if (id && !/^[A-Za-z0-9_-]{11}$/.test(id)) throw new AppError('VALIDATION_ERROR', 'Some fields are invalid.', 422, { fields: { sections: 'YouTube video ID must be 11 characters.' } });
      out.video_id = id || null;
    }
    return out;
  });
  return value;
}

const premiumFields = { status: { type: 'enum', values: ['coming_soon', 'available'] }, price_label: { required: true, max: 30 }, period: { required: true, max: 20 }, trial_days: { type: 'int', min: 0, max: 30 } };
const siteFields = {
  brand_name: { required: true, min: 2, max: 60 }, gaming_identity: { required: true, min: 2, max: 80 },
  website_url: { type: 'url', nullable: true, max: 300 }, tagline: { required: true, min: 2, max: 120 },
  description: { required: true, min: 2, max: 1200 }, about_title: { required: true, min: 2, max: 120 },
  about_lead: { required: true, min: 2, max: 300 }, about_text: { type: 'string', max: 5000 },
  seo_title: { required: true, min: 2, max: 120 }, seo_description: { required: true, min: 2, max: 320 },
  canonical_url: { type: 'url', nullable: true, max: 300 },
};

function parseSite(body) {
  const value = validateFields(siteFields, body);
  const faqs = body?.contact_faqs;
  const errors = {};
  if (!Array.isArray(faqs) || faqs.length > 12) errors.contact_faqs = 'Provide up to 12 question-and-answer pairs.';
  else {
    value.contact_faqs = faqs.map((row, index) => {
      const question = typeof row?.question === 'string' ? row.question.replace(/[\u0000-\u001f\u007f<>]/g, '').trim() : '';
      const answer = typeof row?.answer === 'string' ? row.answer.replace(/[\u0000-\u001f\u007f<>]/g, '').trim() : '';
      if (!question || question.length > 180 || !answer || answer.length > 1000) errors[`contact_faqs.${index}`] = 'Each question must be 1–180 characters and each answer 1–1000 characters.';
      return { question, answer };
    });
  }
  if (Object.keys(errors).length) throw new AppError('VALIDATION_ERROR', 'Some fields are invalid.', 422, { fields: errors });
  return value;
}

export const SETTINGS = { 'newsletter-sending': (body) => validateFields({ daily_limit: { type: 'int', required: true, min: 1, max: 1000 } }, body), promotions:parsePromotions, 'member-benefits':body=>validateFields({community_url:{type:'url',nullable:true,max:500},support_hours:{type:'string',max:300},support_requests_per_day:{type:'int',min:1,max:20}},body), ads: body => validateFields({enabled:{type:"bool",required:true}},body), homepage: parseHomepage, premium: (body) => validateFields(premiumFields, body), site: parseSite };
