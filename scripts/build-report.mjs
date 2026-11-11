// Reproducible local verification only. Does not run migrations, spend provider quota or deploy.
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
const checks=[];
const isWin = process.platform === 'win32';
for(const [name,args]of[['Build',['run','build']],['Tests',['test','--','--test-reporter=tap']],['Migration fixture',['run','test:sql']],['Secret scan',['run','security:secrets']],['Environment',['run','verify:env']]]){
 const result=isWin ? spawnSync('cmd.exe', ['/d', '/s', '/c', `npm ${args.join(' ')}`], { encoding: 'utf8', timeout: 300000 }) : spawnSync('npm', args, { encoding: 'utf8', timeout: 300000 });
 const summary=(result.stdout||'').split('\n').filter(l=>/^# (tests|pass|fail)|files checked|Secret scan passed|^PASS/.test(l));
 checks.push({name,status:result.status===0?'PASS':'FAIL',summary});
}
const report={runtime:process.version,created_at:new Date().toISOString(),checks,live:{supabase:'NOT VERIFIED',payments:'NOT VERIFIED',email:'NOT VERIFIED',ai_providers:'NOT VERIFIED',vercel_deployment:'NOT DEPLOYED'},notes:['Local tests use mocked integrations. No production migrations or writes have run.']};
mkdirSync('reports',{recursive:true});writeFileSync('reports/verification.json',JSON.stringify(report,null,2)+'\n');writeFileSync('reports/verification.md','# Verification\n\n'+checks.map(c=>`- ${c.name}: ${c.status}. ${c.summary.join(' ')}`).join('\n')+'\n\nLive Supabase, payment, email, AI and deployment checks remain unverified without credentials.\n');console.log(JSON.stringify(report,null,2));if(checks.some(c=>c.status==='FAIL'))process.exitCode=1;
