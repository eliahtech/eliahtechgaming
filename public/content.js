// Page copy for Eliah Tech. Legal pages describe how the platform is designed to operate
// (Supabase, Resend email, PesaPal/PayPal payments, AI providers, ads).
// Have a qualified lawyer review them before launch, and update if your setup changes.

export const LEGAL_UPDATED = 'September 30, 2026';

export const pages = {
  about: {
    eyebrow:'ABOUT ELIAHTECH GAMING',title:'Practical gaming guidance, made clear.',
    lead:'Gaming guides and support from Kenya for players everywhere.',
    body:`<h2>Learn, play, improve</h2><p>Eliahtech Gaming covers PSP and PPSSPP, football games, Android games, installation guides, graphics and textures, gaming tech tips, and AI for gaming creators.</p><h2>Useful help for your device</h2><p>Explore step-by-step guides, save the instructions you need, ask our AI assistant or request gaming support. Device compatibility varies; check the requirements in each guide.</p><h2>Premium membership</h2><p>Members get ad-free posts, advanced gaming guides and priority setup support. Available benefits and allowances are shown before checkout.</p><h2>Content standards</h2><p>We publish original tutorials and link to authorized resources. Use the report button to flag an outdated guide or unavailable link.</p><h2>Follow Eliahtech</h2><p>Find our channels in the footer or <a href="/contact">contact us</a> for help.</p>`
  },
  contact: {
    eyebrow: 'CONTACT',
    title: 'Tell us what you are building.',
    lead: 'Questions, project enquiries, partnerships or corrections are all welcome. Send a message below and we will reply by email.',
    body: `<div class="row g-3 my-2">
  <div class="col-md-4"><div class="info-tile"><h3>Project enquiries</h3><p>Websites, Android apps, CMS setup or AI chatbots. Include your goal, timeline and budget range if you have one.</p></div></div>
  <div class="col-md-4"><div class="info-tile"><h3>Help &amp; support</h3><p>Trouble with your account, Premium access or a guide? Tell us what you tried and what you expected.</p></div></div>
  <div class="col-md-4"><div class="info-tile"><h3>Copyright &amp; privacy</h3><p>Use the subject "DMCA" or "Privacy request" so it is reviewed as quickly as possible.</p></div></div>
</div>
<h2>What to expect</h2>
<ul>
<li>Messages are read by a person, not auto-answered by a bot.</li>
<li>We aim to reply within 2 business days. Complex project requests may take a little longer.</li>
<li>We will never ask for your password or payment PIN. Do not send them.</li>
</ul>
<h2>Faster updates</h2>
<p>For quick questions and announcements, join our Telegram or WhatsApp channel from the footer icons.</p>`,
    faq: [
      ['How long does a reply take?', 'Usually within two business days. Project enquiries with clear details get a faster and more useful answer.'],
      ['Can you help with a project outside the listed services?', 'Often yes. Describe what you need and we will tell you honestly whether we are the right fit.'],
      ['Where can I report a broken link or a mistake?', 'Use this form with the subject "Correction" and include the page address.'],
      ['I want my content removed.', 'Send a message with the subject "DMCA" or "Privacy request". See the DMCA and Privacy pages for details.'],
    ],
  },

  privacy: {
    eyebrow: 'PRIVACY POLICY',
    title: 'How we handle your information.',
    lead: 'This policy explains what Eliah Tech collects, why we collect it, who processes it and the choices you have.',
    legal: true,
    body: `<h2>1. Information we collect</h2>
<p><strong>Account information.</strong> When you register we collect your email address and password. Passwords are handled by our authentication provider and are never stored in readable form by us.</p>
<p><strong>Profile and subscription data.</strong> Display name, account type (guest, free, premium, admin), trial dates and subscription status.</p>
<p><strong>Messages and newsletter.</strong> The details you submit through the contact form, and your email address if you subscribe to our newsletter.</p>
<p><strong>Payment records.</strong> We store the provider, transaction reference, amount, currency and status of payments. Card and mobile-money details are handled by the payment provider, not stored by us.</p>
<p><strong>AI chat usage.</strong> Request counts, timestamps and the model used, so we can apply fair-use limits. Messages you send to the assistant are processed by the AI provider to generate a reply.</p>
<p><strong>Technical data.</strong> IP address, browser type, device and pages visited, used for security, rate limiting and analytics.</p>
<h2>2. How we use it</h2>
<ul><li>To create and secure your account and provide Premium features</li><li>To reply to your messages and send transactional emails such as verification and password reset</li><li>To send newsletters, only if you subscribed</li><li>To prevent abuse, fraud and spam</li><li>To improve content and performance</li></ul>
<h2>3. Service providers</h2>
<p>We share only what is needed with providers that help us operate the service:</p>
<ul><li><strong>Supabase</strong> for database, authentication and file storage</li><li><strong>Vercel</strong> for hosting</li><li><strong>Resend</strong> for sending emails</li><li><strong>PesaPal and PayPal</strong> for payment processing</li><li><strong>AI model providers</strong> to generate assistant replies</li><li><strong>Advertising partners</strong> such as Google AdSense on non-home public pages, for free visitors</li></ul>
<p>We do not sell your personal information.</p>
<h2>4. Cookies and similar technologies</h2>
<p>We use essential cookies or browser storage to keep you signed in and protect the site. Advertising partners may use cookies to show and measure ads. You can control cookies in your browser settings, and Premium users can browse without ads.</p>
<h2>5. Data retention</h2>
<p>We keep account data while your account is active. Contact messages are kept as long as needed to handle your request. Payment records may be retained longer where required for accounting or legal reasons. When your free trial ends, your account stays active; we do not delete it.</p>
<h2>6. Your choices and rights</h2>
<p>Depending on where you live, you may have the right to access, correct, export or delete your personal data, and to object to certain processing. You can unsubscribe from newsletters at any time using the link in each email. To make a request, use the <a href="/contact">contact page</a> with the subject "Privacy request".</p>
<h2>7. Security</h2>
<p>We use encrypted connections, access controls, row-level security in our database and server-side authorization for premium and admin features. No system is perfectly secure, so please use a strong, unique password.</p>
<h2>8. Children</h2>
<p>Eliah Tech is not directed to children under 13, and we do not knowingly collect their personal information. If you believe a child has given us data, contact us and we will delete it.</p>
<h2>9. International transfers</h2>
<p>Our providers may process data in other countries. Where required, we rely on appropriate safeguards.</p>
<h2>AI and advertising controls</h2><p>AI messages and screenshots are sent to the selected external provider. Free API providers may use submitted data to improve their services; do not submit passwords or private documents. Saved tasks retain submitted screenshots until completion or deletion. Advertising is limited to eligible posts and excluded for active Premium users. Reader bookmarks, history, device information and follows can be deleted from your gaming space.</p><h2>10. Changes and contact</h2>
<p>We may update this policy and will change the date above when we do. Questions? Use the <a href="/contact">contact page</a>.</p>`,
  },

  terms: {
    eyebrow: 'TERMS & CONDITIONS',
    title: 'The rules for using Eliah Tech.',
    lead: 'By accessing or using this website, the API or any related service, you agree to these terms.',
    legal: true,
    body: `<h2>1. Using the service</h2>
<p>You must provide accurate information and keep your login details secure. You are responsible for activity on your account. You may not misuse the service, attempt unauthorized access, disrupt the platform, scrape it at abusive rates or use it for unlawful activity.</p>
<h2>2. Accounts and access levels</h2>
<p>Eliah Tech has guest, free, Premium and admin access levels. Access is enforced on our servers. Attempts to fake Premium status or bypass restrictions may result in suspension.</p>
<h2>3. Free trial</h2>
<p>A verified new account may receive a Premium trial of a configurable length, currently intended to be 3 days. When the trial ends, Premium features stop and your account remains active as a free account. Trials are limited to one per person.</p>
<h2>4. Premium subscriptions and payments</h2>
<ul><li>Prices and plan features are shown on the Premium page and may change with notice.</li><li>Payments are processed by third-party providers. Access is granted only after the provider's payment is confirmed by our server.</li><li>Unless required by law or stated otherwise at checkout, payments for a period already started are non-refundable. If you were charged in error, contact us promptly.</li></ul>
<h2>5. AI assistant</h2>
<p>The assistant may be inaccurate. Check important information, and do not rely on it for legal, medical or financial decisions. Usage limits apply and depend on your account type. You may not use it to create malware, harass others, break the law or attempt to extract system secrets.</p>
<h2>6. Your content</h2>
<p>Messages, comments and other content you submit must be yours to share and must not infringe others' rights. You grant us a limited licence to store and display content as needed to run the service.</p>
<h2>7. Our content</h2>
<p>Articles, design, logos and code on Eliah Tech belong to us or our licensors. You may share links and short excerpts with credit, but you may not republish full articles or sell our content without written permission.</p>
<h2>8. Downloads and third-party links</h2>
<p>We only aim to provide or link to content that can be lawfully distributed. Third-party sites and files are outside our control, and you use them at your own risk. Always verify what you install.</p>
<h2>9. Services and projects</h2>
<p>Gaming support follows the scope and request allowances stated in your membership plan.</p>
<h2>10. Disclaimer and limits of liability</h2>
<p>The service is provided "as is" and "as available". To the maximum extent permitted by law, Eliah Tech is not liable for indirect or consequential loss, or for loss caused by following guides, installing software or third-party services. Nothing in these terms limits liability that cannot lawfully be limited.</p>
<h2>11. Suspension and termination</h2>
<p>We may suspend or close accounts that break these terms. You can stop using the service or request account deletion at any time.</p>
<h2>12. Changes and governing law</h2>
<p>We may update these terms and will change the date when we do. Continued use means you accept the updated terms. These terms are intended to be governed by the laws of Kenya, subject to any mandatory consumer rights in your country. Contact us through the <a href="/contact">contact page</a> with any questions.</p>`,
  },

  disclaimer: {
    eyebrow: 'DISCLAIMER',
    title: 'Read this before you follow a guide.',
    lead: 'Eliah Tech shares information for education and general guidance. Your device, software and situation are your responsibility.',
    legal: true,
    body: `<h2>General information only</h2>
<p>Our articles, tutorials and AI answers are provided in good faith, but they are not professional advice. Technology changes quickly, so steps that worked when we wrote them may not work on your device or version.</p>
<h2>Software, apps and devices</h2>
<p>Installing software, changing settings or modifying a device can cause data loss, instability or void a warranty. Back up your data, read the official documentation and proceed carefully. We are not responsible for damage that results from following a guide.</p>
<h2>Emulators, mods and third-party files</h2>
<p>Where we discuss emulators or modified apps, we do so for education and safety awareness. You are responsible for making sure you have the legal right to use any game, app or file, and for complying with the terms of the services you use. We do not host or distribute pirated content.</p>
<h2>Online accounts and games</h2>
<p>Using unofficial tools with online games or accounts may violate their rules and can lead to bans. That risk is yours.</p>
<h2>AI-generated content</h2>
<p>AI responses can be wrong, incomplete or out of date. Verify anything important, especially code that you plan to run in production and any legal, financial or medical topics.</p>
<h2>External links</h2>
<p>We link to third-party websites for convenience. We do not control or endorse their content and are not responsible for their availability or accuracy.</p>
<h2>Advertising and affiliate relationships</h2>
<p>Some pages display advertisements. If we ever include affiliate links or sponsored content, we will label them clearly. Advertising does not influence our editorial recommendations.</p>
<h2>Earnings and results</h2>
<p>Any examples of prices, performance or outcomes are illustrative. Your results will vary.</p>`,
  },

  dmca: {
    eyebrow: 'DMCA / COPYRIGHT',
    title: 'We respect creators and rights holders.',
    lead: 'If you believe material on Eliah Tech infringes your copyright, tell us and we will review it promptly.',
    legal: true,
    body: `<h2>Our approach</h2>
<p>Eliah Tech is meant to publish original guides and to link only to content that can be lawfully shared. We respond to valid notices of infringement and may remove or disable access to content while a complaint is reviewed.</p>
<h2>How to submit a takedown notice</h2>
<p>Please send a message through the <a href="/contact">contact page</a> with the subject <strong>DMCA</strong> and include:</p>
<ol>
<li>Your full name, address, email and phone number.</li>
<li>A description of the copyrighted work you say has been infringed.</li>
<li>The exact web address (URL) of the material on Eliah Tech.</li>
<li>A statement that you have a good-faith belief the use is not authorized by the owner, its agent or the law.</li>
<li>A statement, made under penalty of perjury, that the information is accurate and that you are the owner or authorized to act for the owner.</li>
<li>Your physical or electronic signature.</li>
</ol>
<p>Incomplete notices may delay review. Please do not send a notice unless you are sure, because knowingly false claims may carry legal consequences.</p>
<h2>What happens next</h2>
<ul><li>We review the notice and may contact you for more information.</li><li>If it is valid, we remove or disable the material and may notify the person who posted it.</li><li>We may terminate accounts of repeat infringers.</li></ul>
<h2>Counter-notification</h2>
<p>If you believe your content was removed by mistake, send a counter-notification with the subject <strong>DMCA counter-notice</strong>, identifying the removed material, stating under penalty of perjury that you believe it was removed in error, and including your contact details and signature. We may restore the material unless the claimant begins legal action.</p>
<h2>Our own content</h2>
<p>Eliah Tech articles and design are protected. If you see them copied without permission, please let us know.</p>`,
  },
};

export const servicesExtras = {
  steps: [
    ['Discovery', 'We talk through your goals, audience and constraints, then write down a clear scope.'],
    ['Plan & quote', 'You receive a timeline, a fixed or milestone-based quote and the technology we recommend.'],
    ['Build & review', 'We build in stages and show working progress so you can give feedback early.'],
    ['Launch & support', 'We deploy, train your team and stay available for a defined support period.'],
  ],
  faq: [
    ['Do I own the finished website or app?', 'Yes. You should own your domain, content and code. We document everything so another developer can continue the work.'],
    ['How long does a typical project take?', 'A focused business website often takes 2 to 4 weeks. Apps and custom platforms take longer, and we give a timeline in the quote.'],
    ['Can you add an Android app later?', 'Yes. When the backend is API-first, an Android app can use the same accounts and content as the website.'],
    ['Do prices include hosting and domain?', 'Listed prices cover design and development. Hosting, domains and third-party services are billed at cost and explained upfront.'],
    ['Will you help after launch?', 'Yes. Every project includes a support window, and ongoing maintenance is available.'],
  ],
};

export const premiumExtras = {
  compare: [
    ['Read free articles and guides', true, true, true],
    ['Browse posts without ads', false, true, true],
    ['Advanced gaming guides', false, true, true],
    ['Priority gaming support', false, true, true],
    ['AI assistant', 'Limited', 'Standard limit', 'Higher limit'],
    ['Newsletter', true, true, true],
  ],
  faq: [
    ['How does the 3-day trial work?', 'After you register and verify your email, your account gets Premium access for 3 days. No payment is needed to start.'],
    ['What happens when the trial ends?', 'Premium features turn off and your account continues as a free account. We never delete your account because a trial ended.'],
    ['Which payment methods will be available?', 'You choose PesaPal or PayPal at checkout. PesaPal shows the payment methods available to you on its secure checkout page; PayPal handles PayPal payments.'],
    ['Is my Premium status secure?', 'Yes. Premium is verified on our servers after the payment provider confirms the transaction. It cannot be unlocked from your browser.'],
    ['Can I cancel?', 'You can stop renewing at any time. You keep access until the end of the period you paid for.'],
  ],
};
