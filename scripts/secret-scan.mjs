import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const root=process.cwd();
const skip=new Set(['.git','node_modules','.next','.vinext','.cloudflare','.wrangler','dist','coverage']);
const highConfidence=[/-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/,/\b(?:sk_live_[A-Za-z0-9_-]{20,}|rk_live_[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{20,}|AIza[0-9A-Za-z_-]{30,}|gsk_[A-Za-z0-9]{32,}|sk-[A-Za-z0-9]{28,})/];
const assignments=/^[ \t]*(SUPABASE_SERVICE_ROLE_KEY|RESEND_API_KEY|PAYPAL_CLIENT_SECRET|PESAPAL_CONSUMER_SECRET|SUPABASE_AUTH_HOOK_SECRET)[ \t]*=[ \t]*['\"]?([^\r\n#'\"]*)/gm;
const placeholders=/^(?:|your(?:[-_].*)?|replace(?:[-_].*)?|example(?:[-_].*)?|changeme|change-me|test(?:[-_].*)?|<[^>]+>|\.\.\.)$/i;const hits=[];
function check(file,text){if(file.split(/[\\/]/).includes('test'))return;for(const pattern of highConfidence){pattern.lastIndex=0;if(pattern.test(text)){hits.push(file);return}}if(file.startsWith('.env')){for(const match of text.matchAll(assignments)){if(!placeholders.test(match[2].trim())){hits.push(file);return}}}}
function walk(dir=''){for(const entry of readdirSync(path.join(root,dir),{withFileTypes:true})){if(entry.isDirectory()&&skip.has(entry.name))continue;const rel=path.join(dir,entry.name);if(entry.isDirectory())walk(rel);else{try{const data=readFileSync(path.join(root,rel));if(!data.includes(0))check(rel,data.toString('utf8'))}catch{}}}}
walk();
try{const listing=execFileSync('git',['rev-list','--objects','--all'],{cwd:root,encoding:'utf8',maxBuffer:32*1024*1024,stdio:['ignore','pipe','ignore']});for(const line of listing.split('\n')){const match=/^([a-f0-9]{40,64}) (.+)$/.exec(line);if(!match)continue;const [,oid,file]=match;if(file.split('/').includes('test'))continue;try{const data=execFileSync('git',['cat-file','blob',oid],{cwd:root,encoding:'utf8',maxBuffer:8*1024*1024,stdio:['ignore','pipe','ignore']});check(`Git history: ${file}`,data)}catch{}}}catch{}
if(hits.length){console.error(`Secret scan failed: possible credential in ${[...new Set(hits)].join(', ')}. Review privately; matched values are never printed.`);process.exitCode=1}else console.log('Secret scan passed: no high-confidence credentials or populated known secret fields found in production files or non-test Git history. Test files are excluded from token-pattern checks because they contain mock credentials.');
