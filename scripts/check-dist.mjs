// Asserts on the BUILT site (dist/) and prints one VERDICT. Run after `npm run build`.
// usage: node scripts/check-dist.mjs --kit <the same ai-second-opinion checkout the sync read>
//
// Checks: every page exists; the canonical URL is the domain root (no base path anywhere - a `base` left in
// sends every asset to a path that does not exist); the pages say which release they come from; every internal
// link and #anchor resolves; every link into the kit repo at the tag names a file the tag has; every `--flag`
// of a source document survives into its page (smartypants would turn `--only` into an en dash).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const DIST = path.join(ROOT, 'dist');
const i = process.argv.indexOf('--kit');
const KIT = i > 0 ? process.argv[i + 1] : process.env.KIT_DIR;
const meta = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'generated', 'kit.json'), 'utf8'));
const fails = [];
let checks = 0;
const ok = (cond, msg) => {
  checks++;
  if (!cond) fails.push(msg);
};

const walk = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
const files = fs.existsSync(DIST) ? walk(DIST) : [];
ok(files.length > 0, 'dist/ is empty or missing - run npm run build');
const html = files.filter((f) => f.endsWith('.html'));
const read = (rel) => fs.readFileSync(path.join(DIST, rel), 'utf8');
const pageFile = (route) => path.join(route.replace(/^\//, ''), 'index.html');

for (const rel of ['404.html', 'llms.txt', 'llms-full.txt', 'sitemap-index.xml', 'robots.txt', '.well-known/security.txt', 'kit.json', 'favicon.svg'])
  ok(fs.existsSync(path.join(DIST, rel)), `missing dist/${rel}`);
for (const p of meta.pages) ok(fs.existsSync(path.join(DIST, pageFile(p.route))), `missing page ${p.route} (from ${p.src})`);
if (fails.length) finish();

const home = read('index.html');
ok(home.includes('<link rel="canonical" href="https://secondai.net/"'), 'home: canonical is not https://secondai.net/');
ok(/<html[^>]*lang="en"/.test(home), 'home: html lang is not en');
ok(/<html[^>]*lang="ru"/.test(read('ru/index.html')), '/ru/: html lang is not ru');
ok(home.includes(meta.tag) && home.includes(meta.date), `home: the banner does not name ${meta.tag} (${meta.date})`);
ok(home.includes(meta.title), `home: the title "${meta.title}" is missing`);
ok(read('llms.txt').includes(meta.title), 'llms.txt does not name the project');
ok(read('robots.txt').includes('Sitemap: https://secondai.net/sitemap-index.xml'), 'robots.txt has no Sitemap line for the domain');
ok(JSON.parse(read('kit.json')).tag === meta.tag, 'dist/kit.json names another tag');

const ids = new Map();
const idsOf = (file) => {
  if (!ids.has(file)) ids.set(file, new Set([...fs.readFileSync(file, 'utf8').matchAll(/\sid="([^"]+)"/g)].map((m) => decodeURIComponent(m[1]))));
  return ids.get(file);
};
const decode = (s) => s.replace(/&amp;/g, '&');
let internal = 0;
let anchors = 0;
let kitLinks = 0;
const kitPrefix = `${meta.repo}/`;
for (const file of html) {
  const text = fs.readFileSync(file, 'utf8');
  const rel = path.relative(DIST, file).split(path.sep).join('/');
  ok(!text.includes('/page2ai-docs') && !/github\.io\/secondai/.test(text), `${rel}: a base path or github.io address is left in`);
  for (const m of text.matchAll(/\s(?:href|src)="([^"]+)"/g)) {
    const url = decode(m[1]);
    if (url.startsWith('/') && !url.startsWith('//')) {
      internal++;
      const [p, hash] = url.split('#');
      const clean = p.split('?')[0];
      const target = clean.endsWith('/') ? path.join(DIST, clean, 'index.html') : path.join(DIST, clean);
      const exists = fs.existsSync(target) || fs.existsSync(path.join(DIST, clean, 'index.html'));
      ok(exists, `${rel}: internal link ${url} has no file`);
      if (exists && hash && target.endsWith('.html')) {
        anchors++;
        ok(idsOf(target).has(decodeURIComponent(hash)), `${rel}: ${url} - no id "${decodeURIComponent(hash)}" on that page`);
      }
    } else if (url.startsWith('#') && url.length > 1 && !url.startsWith('#_')) {
      anchors++;
      ok(idsOf(file).has(decodeURIComponent(url.slice(1))), `${rel}: in-page anchor ${url} has no id`);
    } else if (url.startsWith(kitPrefix) && KIT) {
      const m2 = url.slice(kitPrefix.length).match(/^(blob|tree)\/([^/]+)\/([^#?]+)/);
      if (m2) {
        kitLinks++;
        ok(m2[2] === meta.tag, `${rel}: kit link at ${m2[2]}, the site is ${meta.tag}`);
        ok(fs.existsSync(path.join(KIT, decodeURIComponent(m2[3]))), `${rel}: kit link to ${m2[3]} - the tag has no such file`);
      }
    }
  }
}

// --flags of every source document must reach its page unchanged
let flags = 0;
if (KIT) {
  for (const p of meta.pages) {
    const src = fs.readFileSync(path.join(KIT, p.src), 'utf8');
    const page = read(pageFile(p.route));
    const wanted = new Set([...src.matchAll(/(?<![\w-])--[a-z][a-z0-9-]{2,}/g)].map((m) => m[0]));
    for (const w of wanted) {
      flags++;
      ok(page.includes(w) || p.src === 'CHANGELOG.md', `${p.route}: "${w}" from ${p.src} is not on the page`);
    }
  }
}

finish();
function finish() {
  for (const f of fails.slice(0, 40)) console.log('FAIL ' + f);
  if (fails.length > 40) console.log(`... and ${fails.length - 40} more`);
  console.log(`checks ${checks}: internal links ${internal}, anchors ${anchors}, kit links ${kitLinks}, --flags ${flags}; ${html.length} HTML files`);
  console.log(fails.length ? `VERDICT: FAIL (${fails.length})` : 'VERDICT: OK');
  process.exit(fails.length ? 1 : 0);
}
