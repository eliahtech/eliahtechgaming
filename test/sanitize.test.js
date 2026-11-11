// Requires sanitize-html (npm install).
import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeContent } from '../src/sanitize.js';

test('removes scripts, event handlers and javascript: links', () => {
  const out = sanitizeContent('<p onclick="x()">Hi</p><script>alert(1)</script><a href="javascript:alert(1)">l</a><img src="x" onerror="alert(1)">');
  assert.doesNotMatch(out, /script|onclick|onerror|javascript:/i);
  assert.match(out, /<p>Hi<\/p>/);
});

test('keeps rich-editor content: headings, tables, code, quotes, links with safe rel', () => {
  const out = sanitizeContent('<h2>T</h2><blockquote>q</blockquote><pre class="language-js"><code>x</code></pre><table class="table"><tr><td>1</td></tr></table><a href="https://example.com" target="_blank">e</a>');
  for (const part of ['<h2>T</h2>', '<blockquote>', 'language-js', '<table class="table">', 'rel="noopener noreferrer"']) assert.ok(out.includes(part), part);
});

test('only YouTube iframes survive', () => {
  assert.match(sanitizeContent('<iframe src="https://www.youtube-nocookie.com/embed/abc"></iframe>'), /youtube-nocookie/);
  assert.doesNotMatch(sanitizeContent('<iframe src="https://evil.example/x"></iframe>'), /evil\.example/);
});

test('data: image sources are dropped (pasted pictures are uploaded by the editor instead)', () => {
  assert.doesNotMatch(sanitizeContent('<img src="data:text/html;base64,AAAA">'), /data:/);
  assert.doesNotMatch(sanitizeContent('<img src="data:image/svg+xml;base64,AAAA">'), /data:/);
});

test('image links people actually paste are repaired instead of silently dropped', () => {
  assert.match(sanitizeContent('<img src="//cdn.example/a.png">'), /src="https:\/\/cdn\.example\/a\.png"/);
  assert.match(sanitizeContent('<img src="http://cdn.example/a.png">'), /src="https:\/\/cdn\.example\/a\.png"/);
  assert.match(sanitizeContent('<img data-src="https://cdn.example/lazy.jpg" alt="x">'), /src="https:\/\/cdn\.example\/lazy\.jpg"/);
  assert.match(sanitizeContent('<img src="https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view?usp=sharing">'), /lh3\.googleusercontent\.com\/d\/1AbCdEfGhIjKlMnOp/);
  const out = sanitizeContent('<img src="https://cdn.example/a.png" onerror="x()" srcset="https://cdn.example/a2.png 2x">');
  assert.match(out, /loading="lazy"/); assert.match(out, /referrerpolicy="no-referrer"/); assert.match(out, /srcset=/); assert.doesNotMatch(out, /onerror/);
  assert.doesNotMatch(sanitizeContent('<img src="javascript:alert(1)">'), /<img/);
});

test('pasted HTML keeps its look: classes, safe inline styles and scoped <style> blocks survive; dangerous CSS does not', () => {
  const out = sanitizeContent('<style>body{background:#000;color:#fff}.card{padding:10px;background:url(javascript:alert(1))}@import url(https://evil.example/x.css);header{position:fixed}</style><section class="card" style="color:red;background:url(https://evil.example/t.png);position:fixed"><header>H</header></section>');
  assert.match(out, /<style>/); assert.match(out, /\.article-body \.post-html\{background:#000;color:#fff\}/); assert.match(out, /\.article-body \.post-html \.card\{padding:10px;/);
  assert.doesNotMatch(out, /javascript:|@import|evil\.example|position:fixed/);
  assert.match(out, /<section class="card" style="color:red">/);
  assert.equal(sanitizeContent(out), out, 'sanitizing twice must not change the result');
});
