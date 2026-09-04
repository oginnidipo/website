import { cp, mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const output = resolve(root, 'dist');
execFileSync(process.execPath, ['--test', 'scripts/site.test.mjs'], { cwd:root, stdio:'inherit' });
// Build only the explicit public-site allowlist. Never ship source, workers or local configuration.
await rm(output, { recursive:true, force:true });
await mkdir(output, { recursive:true });
const publicPaths = ['index.html','now.html','404.html','blog','styles.css','site.js',
  'favicon.svg','apple-touch-icon.png','og-image.png','assets','resume.pdf','robots.txt','sitemap.xml','feed.xml','CNAME'];
for (const path of publicPaths) await cp(resolve(root,path), resolve(output,path), { recursive:true });
console.log(`Built ${publicPaths.length} public entries → dist/`);
