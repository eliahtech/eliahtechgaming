// Email bodies. Every dynamic value is HTML-escaped; links are built by the server, never taken from user input.
const SITE = 'Eliahtech Gaming';
export const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const paragraphs = (text) => esc(text).split(/\r?\n\r?\n/).map((p) => `<p style="margin:0 0 14px">${p.replace(/\r?\n/g, '<br>')}</p>`).join('');

const emailBrand = () => {
  const base = String(process.env.APP_URL || '').replace(/\/$/,'');
  return /^https:\/\//.test(base) ? `<img src="${esc(base+'/assets/branding/etg-logo-email.png')}" width="160" height="120" alt="${SITE}" style="display:block;object-fit:contain">` : SITE;
};
const layout = (inner, footer = '') => `<!doctype html><html><body style="margin:0;background:#0b1020;padding:24px;font-family:Arial,Helvetica,sans-serif"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center"><table role="presentation" width="100%" style="max-width:600px;background:#ffffff;border-radius:12px"><tr><td style="padding:24px 28px;background:#111936;border-radius:12px 12px 0 0;color:#ffffff;font-size:20px;font-weight:bold">${emailBrand()}</td></tr><tr><td style="padding:28px;color:#1b2340;font-size:15px;line-height:1.6">${inner}</td></tr>${footer ? `<tr><td style="padding:0 28px 24px;color:#6b7392;font-size:12px;line-height:1.5">${footer}</td></tr>` : ''}</table></td></tr></table></body></html>`;
const button = (url, label) => `<p style="margin:22px 0"><a href="${esc(url)}" style="background:#7c3aed;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;display:inline-block;font-weight:bold">${esc(label)}</a></p><p style="font-size:12px;color:#6b7392;word-break:break-all">If the button does not work, copy this link into your browser:<br>${esc(url)}</p>`;

export const newsletterVerify = ({ url }) => ({
  subject: `Confirm your ${SITE} subscription`,
  html: layout(`<h2 style="margin:0 0 12px">One more step</h2><p>Confirm your email address to start receiving the ${SITE} newsletter.</p>${button(url, 'Confirm subscription')}`, 'If you did not request this, you can ignore this email and nothing will happen.'),
  text: `Confirm your ${SITE} newsletter subscription: ${url}\n\nIf you did not request this, ignore this email.`,
});

export const contactReply = ({ name, body, originalSubject, originalMessage }) => ({
  subject: `Re: ${String(originalSubject ?? '').replace(/^re:\s*/i, '')}`,
  html: layout(`<p>Hi ${esc(name)},</p>${paragraphs(body)}<hr style="border:none;border-top:1px solid #e3e6f0;margin:22px 0"><p style="color:#6b7392;font-size:13px;margin:0 0 6px">Your message:</p><blockquote style="margin:0;padding-left:12px;border-left:3px solid #d5d9e8;color:#4a5272;font-size:13px">${paragraphs(originalMessage)}</blockquote>`),
  text: `Hi ${name},\n\n${body}\n\n---\nYour message:\n${originalMessage}`,
});

export const newsletterIssue = ({ subject, contentHtml, unsubscribeUrl }) => ({
  subject,
  html: layout(contentHtml, `You are receiving this because you subscribed to the ${SITE} newsletter. <a href="${esc(unsubscribeUrl)}" style="color:#6b7392">Unsubscribe</a>`),
  text: `${subject}\n\n${String(contentHtml).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()}\n\nUnsubscribe: ${unsubscribeUrl}`,
});

const AUTH_COPY = {
  signup: ['Confirm your email address', 'Welcome to Eliah Tech. Confirm your email address to activate your account and start your free trial.', 'Confirm email'],
  invite: ['You have been invited', 'You have been invited to join Eliah Tech. Accept the invitation to set up your account.', 'Accept invitation'],
  magiclink: ['Your sign-in link', 'Use the button below to sign in. The link works once and expires soon.', 'Sign in'],
  recovery: ['Reset your password', 'We received a request to reset your password. If this was you, choose a new password with the button below.', 'Reset password'],
};
export const AUTH_TYPES = [...Object.keys(AUTH_COPY), 'reauthentication'];

export function authEmail({ type, url, code }) {
  if (type === 'reauthentication') {
    return { subject: `Your ${SITE} confirmation code`, html: layout(`<h2 style="margin:0 0 12px">Confirmation code</h2><p style="font-size:26px;letter-spacing:4px;font-weight:bold">${esc(code)}</p><p>Enter this code to confirm the change.</p>`, 'If you did not request this, secure your account.'), text: `Your ${SITE} confirmation code: ${code}` };
  }
  const [heading, lead, label] = AUTH_COPY[type];
  return { subject: `${heading} — ${SITE}`, html: layout(`<h2 style="margin:0 0 12px">${esc(heading)}</h2><p>${esc(lead)}</p>${button(url, label)}`, 'If you did not request this, you can safely ignore this email.'), text: `${heading}\n\n${lead}\n\n${url}\n\nIf you did not request this, ignore this email.` };
}

// ---- Payments (amounts and names come from our own database, all values escaped) ----
const moneyText = (amount, currency) => `${esc(currency)} ${esc(amount)}`;
export const paymentInitiated = ({ name, plan, amount, currency, provider }) => ({
  subject: `${SITE}: payment started for ${plan}`,
  html: layout(`<h2 style="margin:0 0 12px">Payment started</h2><p>Hi ${esc(name)}, you started a payment of <strong>${moneyText(amount, currency)}</strong> for <strong>${esc(plan)}</strong> through ${esc(provider)}.</p><p>Premium is switched on only after the payment provider confirms the payment. If you did not start this, you can ignore this email.</p>`),
  text: `Hi ${name}, you started a payment of ${currency} ${amount} for ${plan} through ${provider}. Premium is switched on only after the provider confirms the payment. If you did not start this, ignore this email.`,
});
export const paymentSucceeded = ({ name, plan, amount, currency, expiresAt, reference }) => ({
  subject: `${SITE}: payment received, Premium is active`,
  html: layout(`<h2 style="margin:0 0 12px">Thank you, payment received</h2><p>Hi ${esc(name)}, we received <strong>${moneyText(amount, currency)}</strong> for <strong>${esc(plan)}</strong>.</p><p>Your Premium subscription is active${expiresAt ? ` until <strong>${esc(String(expiresAt).slice(0, 10))}</strong>` : ''}.</p>${reference ? `<p style="color:#6b7392;font-size:13px">Reference: ${esc(reference)}</p>` : ''}`),
  text: `Hi ${name}, we received ${currency} ${amount} for ${plan}. Your Premium subscription is active${expiresAt ? ` until ${String(expiresAt).slice(0, 10)}` : ''}.${reference ? ` Reference: ${reference}` : ''}`,
});
export const paymentFailed = ({ name, plan, amount, currency }) => ({
  subject: `${SITE}: your payment did not go through`,
  html: layout(`<h2 style="margin:0 0 12px">Payment not completed</h2><p>Hi ${esc(name)}, the payment of <strong>${moneyText(amount, currency)}</strong> for <strong>${esc(plan)}</strong> did not go through, so Premium was not activated.</p><p>You can try again from the Premium page. If money left your account, the payment provider will reverse it, or contact us.</p>`),
  text: `Hi ${name}, the payment of ${currency} ${amount} for ${plan} did not go through, so Premium was not activated. You can try again from the Premium page.`,
});
