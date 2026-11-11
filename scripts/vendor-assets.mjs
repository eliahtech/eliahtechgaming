import { mkdirSync, copyFileSync } from 'node:fs';
mkdirSync('public/vendor',{recursive:true});
for(const [from,to] of [['node_modules/bootstrap/dist/css/bootstrap.min.css','bootstrap.min.css'],['node_modules/bootstrap/dist/js/bootstrap.bundle.min.js','bootstrap.bundle.min.js'],['node_modules/bootstrap/LICENSE','BOOTSTRAP-LICENSE.txt']])copyFileSync(from,'public/vendor/'+to);
console.log('Bootstrap assets prepared. Optional editor: node scripts/vendor-editor.mjs');
