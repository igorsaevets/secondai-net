// Writes the site's pages from the kit's own documents at ONE release tag, so the site cannot say anything the
// kit's documents do not say for that release. Everything under src/content/docs/ and src/generated/ is written
// here and gitignored: to change a sentence on the site, change the kit's document and release it.
//
// usage: node scripts/sync-kit-docs.mjs --kit <ai-second-opinion checkout AT the tag> --tag <vX.Y.Z>
//        (or KIT_DIR / KIT_TAG in the environment)
//
// What it does to each document: the first `# ` heading becomes the page title; relative links to documents the
// site renders become site links (anchor kept), any other relative link goes to the file on GitHub at the tag;
// code spans and fenced code are left alone. The README's badge lines are dropped (they load third-party images)
// and its first paragraph becomes the home page's tagline. The changelog keeps its newest NEWEST sections and links
// the whole file at the tag. Each page carries a banner naming its source file and release.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = 'https://github.com/igorsaevets/ai-second-opinion';
const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const OUT = path.join(ROOT, 'src', 'content', 'docs');
const GEN = path.join(ROOT, 'src', 'generated');
const NEWEST = 12;

// source document -> page; `home` = the locale's front page
const PAGES = [
  { src: 'README.md', out: 'index.md', route: '/', home: 'en' },
  { src: 'README.ru.md', out: 'ru/index.md', route: '/ru/', home: 'ru' },
  { src: 'INSTALL.md', out: 'install.md', route: '/install/' },
  { src: 'TECHNICAL.md', out: 'technical.md', route: '/technical/' },
  { src: 'TROUBLESHOOTING.md', out: 'troubleshooting.md', route: '/troubleshooting/' },
  { src: 'PRIVACY.md', out: 'privacy.md', route: '/privacy/' },
  { src: 'SECURITY.md', out: 'security.md', route: '/security/' },
  { src: 'CONTRIBUTING.md', out: 'contributing.md', route: '/contributing/' },
  { src: 'CHANGELOG.md', out: 'changelog.md', route: '/changelog/', newest: NEWEST },
];
const ROUTE = Object.fromEntries(PAGES.map((p) => [p.src, p.route]));
const HOME_TEXT = {
  en: { install: 'Install', technical: 'Technical description', banner: 'From' , of: 'of' },
  ru: { install: 'Установка', technical: 'Техническое описание', banner: 'Из', of: 'релиза' },
};

function die(msg) {
  console.error('FAIL ' + msg);
  console.error('VERDICT: FAIL (nothing written)');
  process.exit(1);
}

function arg(name, env) {
  const i = process.argv.indexOf('--' + name);
  return i > 0 ? process.argv[i + 1] : process.env[env];
}

const KIT = arg('kit', 'KIT_DIR');
const TAG = arg('tag', 'KIT_TAG');
if (!KIT || !TAG) die('usage: node scripts/sync-kit-docs.mjs --kit <ai-second-opinion checkout> --tag <vX.Y.Z>');
if (!/^v\d+\.\d+\.\d+$/.test(TAG)) die(`tag ${TAG} does not look like vX.Y.Z`);

const git = (...a) => execFileSync('git', ['-C', KIT, ...a], { encoding: 'utf8' }).trim();
// The checkout must BE the tag, with no local edits to the documents: a site from a mixed tree would print one
// release's number over another release's words.
let atTag = '';
try {
  atTag = git('tag', '--points-at', 'HEAD').split(/\s+/);
} catch (e) {
  die(`${KIT} is not a git checkout (${e.message.split('\n')[0]})`);
}
if (!atTag.includes(TAG)) die(`the checkout's HEAD is not tag ${TAG} (tags at HEAD: ${atTag.join(' ') || 'none'})`);
const dirty = git('status', '--porcelain', '--', ...PAGES.map((p) => p.src));
if (dirty) die(`the checkout has local changes in its documents:\n${dirty}`);
const versionFiles = fs.globSync ? fs.globSync('plugins/*/skills/*/VERSION', { cwd: KIT }) : [];
for (const v of versionFiles) {
  const value = fs.readFileSync(path.join(KIT, v), 'utf8').trim();
  if ('v' + value !== TAG) die(`${v} says ${value}, the tag is ${TAG}`);
}
const DATE = git('log', '-1', '--format=%cs');

const plain = (md) =>
  md
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*|__/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const IMAGE = /\.(png|jpe?g|gif|svg|webp|avif)$/i;
const broken = [];

function rewriteTarget(target, src) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('#') || target.startsWith('/')) return target;
  const hash = target.indexOf('#');
  const file = path.posix.normalize((hash < 0 ? target : target.slice(0, hash)).replace(/^\.\//, ''));
  const anchor = hash < 0 ? '' : target.slice(hash);
  if (ROUTE[file]) return ROUTE[file] + anchor;
  const abs = path.join(KIT, file);
  if (!fs.existsSync(abs)) {
    broken.push(`${src}: ${target}`);
    return target;
  }
  if (IMAGE.test(file)) return `https://raw.githubusercontent.com/igorsaevets/ai-second-opinion/${TAG}/${file}`;
  const kind = fs.statSync(abs).isDirectory() ? 'tree' : 'blob';
  return `${REPO}/${kind}/${TAG}/${file}${anchor}`;
}

const LINK = /\]\(([^)\s]+)(\s+"[^"]*")?\)/g;
function rewriteLine(line, src) {
  // odd parts are code spans: left as typed
  return line
    .split(/(`+[^`]*`+)/)
    .map((part, i) => (i % 2 ? part : part.replace(LINK, (m, t, title = '') => `](${rewriteTarget(t, src)}${title})`)))
    .join('');
}

function transform(text, page) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  if (!lines[0].startsWith('# ')) die(`${page.src}: the first line is not a "# " heading`);
  const title = lines[0].slice(2).trim();
  let body = lines.slice(1);
  let tagline = '';
  if (page.home) {
    // drop the badge lines before the first paragraph, then lift that paragraph into the hero
    let i = 0;
    while (i < body.length && (body[i].trim() === '' || body[i].startsWith('[!['))) i++;
    let j = i;
    while (j < body.length && body[j].trim() !== '') j++;
    tagline = plain(body.slice(i, j).join(' '));
    body = body.slice(j);
  }
  if (page.newest) {
    const starts = body.map((l, n) => (l.startsWith('## ') ? n : -1)).filter((n) => n >= 0);
    const refs = body.filter((l) => /^\[[^\]]+\]: \S/.test(l));
    if (starts.length > page.newest) {
      body = body.slice(0, starts[page.newest]);
      body.push(
        '---',
        '',
        `Older releases: [the whole CHANGELOG.md of ${TAG}](${REPO}/blob/${TAG}/CHANGELOG.md).`,
        '',
        ...refs,
      );
    }
  }
  let fence = null;
  const out = body.map((l) => {
    const m = l.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (m) {
      if (!fence) fence = m[1];
      else if (m[1][0] === fence[0] && m[1].length >= fence.length) fence = null;
      return l;
    }
    return fence ? l : rewriteLine(l, page.src);
  });
  // description: the home page's lead sentence, else the first prose paragraph
  let description = '';
  const prose = out.find((l) => l.trim() && !/^(#|\||>|-|\*|\d+\.|`|<|\[!\[)/.test(l.trim()));
  if (page.home) {
    const lead = out.find((l) => l.startsWith('**'));
    description = lead ? plain(lead.match(/^\*\*(.+?)\*\*/)?.[1] ?? lead) : tagline;
  } else if (prose) description = plain(prose);
  if (description.length > 200) description = description.slice(0, 197).replace(/\s+\S*$/, '') + '…';
  if (!description) description = `${title} - ai-second-opinion ${TAG}`;
  return { title, description, tagline, body: out.join('\n') };
}

const q = (s) => JSON.stringify(s);
function frontmatter(page, t) {
  const lang = page.home === 'ru' ? 'ru' : 'en';
  const words = HOME_TEXT[lang];
  const src = `<a href="${REPO}/blob/${TAG}/${page.src}">${page.src}</a>`;
  const rel = `<a href="${REPO}/releases/tag/${TAG}">ai-second-opinion ${TAG}</a>`;
  const fm = [
    '---',
    `title: ${q(t.title)}`,
    `description: ${q(t.description)}`,
    'editUrl: false',
    'banner:',
    `  content: ${q(`${words.banner} ${src} ${words.of} ${rel} (${DATE}).`)}`,
  ];
  if (page.home) {
    const pre = lang === 'ru' ? '/ru' : '';
    fm.push(
      'hero:',
      `  tagline: ${q(t.tagline)}`,
      '  actions:',
      `    - text: ${q(words.install)}`,
      `      link: ${q(pre + '/install/')}`,
      '      icon: right-arrow',
      `    - text: ${q(words.technical)}`,
      `      link: ${q(pre + '/technical/')}`,
      '      variant: secondary',
      '    - text: "GitHub"',
      `      link: ${q(REPO)}`,
      '      icon: external',
      '      variant: minimal',
    );
  }
  fm.push('---', '');
  return fm.join('\n');
}

const results = [];
for (const page of PAGES) {
  const file = path.join(KIT, page.src);
  if (!fs.existsSync(file)) die(`${page.src} is not in the checkout`);
  const t = transform(fs.readFileSync(file, 'utf8'), page);
  results.push({ page, t });
}
if (broken.length) die(`relative links to files the kit does not have:\n  ${broken.join('\n  ')}`);

// write only now: a failed run above leaves the previous pages in place
if (!OUT.endsWith(path.join('src', 'content', 'docs'))) die(`refusing to clear ${OUT}`);
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(GEN, { recursive: true });
for (const { page, t } of results) {
  const dest = path.join(OUT, page.out);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, frontmatter(page, t) + t.body.replace(/^\n+/, '') + '\n');
}
const en = results.find((r) => r.page.home === 'en').t;
const ru = results.find((r) => r.page.home === 'ru').t;
const meta = {
  tag: TAG,
  date: DATE,
  repo: REPO,
  title: en.title,
  description: en.description,
  tagline: { en: en.tagline, ru: ru.tagline },
  pages: PAGES.map((p) => ({ src: p.src, route: p.route })),
};
fs.writeFileSync(path.join(GEN, 'kit.json'), JSON.stringify(meta, null, 2) + '\n');
fs.writeFileSync(path.join(ROOT, 'public', 'kit.json'), JSON.stringify({ tag: TAG, date: DATE }) + '\n');
console.log(`OK wrote ${results.length} pages from ai-second-opinion ${TAG} (${DATE})`);
console.log('VERDICT: OK');
