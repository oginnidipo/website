import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';

const root = resolve(import.meta.dirname, '..');
const pages = ['index.html','now.html','404.html','domain.html','blog/index.html','blog/ai-platform-engineering.html',
  'blog/kubernetes-production-readiness.html','blog/cloud-cost-optimization.html','projects/k8s-cost-radar.html'];
const documents = new Map(pages.map(path => [path, readFileSync(resolve(root,path),'utf8')]));
const voidTags = new Set('area base br col embed hr img input link meta param source track wbr'.split(' '));

for (const [path, html] of documents) {
  test(`${path}: balanced markup, unique IDs, one H1 and accessible shell`, () => {
    const clean = html.replace(/<!--[\s\S]*?-->/g,'').replace(/(<script\b[^>]*>)[\s\S]*?(<\/script>)/g,'$1$2');
    const stack = [];
    for (const match of clean.matchAll(/<(\/?)([a-z][a-z0-9:-]*)\b[^>]*>/gi)) {
      const tag = match[2].toLowerCase();
      if (voidTags.has(tag) || match[0].endsWith('/>')) continue;
      if (match[1]) assert.equal(stack.pop(),tag,`${path}: mismatched closing ${tag}`);
      else stack.push(tag);
    }
    assert.deepEqual(stack,[]);
    assert.equal((html.match(/<h1\b/g)||[]).length,1);
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
    assert.equal(ids.length,new Set(ids).size,'duplicate IDs');
    assert.match(html,/<html lang="en">/);
    assert.match(html,/name="viewport"/);
    assert.match(html,/class="skip-link"/);
    assert.match(html,/aria-controls="primary-navigation"/);
    assert.match(html,/<script src="[^"<>]*site\.js" defer><\/script>/);
    assert.doesNotMatch(html,/\son(?:click|load)="/);
    assert.doesNotMatch(html,/animate-target/,'content must remain visible without JS');
  });
  test(`${path}: local destinations and anchors exist`, () => {
    for (const [,value] of html.matchAll(/\b(?:href|src)="([^"]+)"/g)) {
      if (/^(https?:|mailto:|data:|tel:)/.test(value)) continue;
      const url = new URL(value,`https://dipops.com/${path}`);
      let relative = decodeURIComponent(url.pathname.slice(1));
      if (!relative || relative.endsWith('/')) relative += 'index.html';
      assert.ok(existsSync(resolve(root,relative)),`${path}: missing ${value}`);
      if (url.hash && documents.has(relative)) {
        assert.ok(documents.get(relative).includes(`id="${decodeURIComponent(url.hash.slice(1))}"`),`${path}: missing anchor ${value}`);
      }
    }
  });
  test(`${path}: inline JavaScript and JSON-LD parse`, () => {
    for (const [,attrs,content] of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)) {
      if (attrs.includes('application/ld+json')) JSON.parse(content);
      else if (!attrs.includes('src=')) new vm.Script(content);
    }
  });
}

function element() {
  const attributes = new Map(), classes = new Set(), listeners = new Map();
  return {
    classList:{ add:name => classes.add(name), contains:name => classes.has(name),
      toggle(name,force) { const on=force ?? !classes.has(name); on ? classes.add(name):classes.delete(name); return on; } },
    setAttribute:(key,value) => attributes.set(key,value), getAttribute:key => attributes.get(key),
    addEventListener:(name,handler) => listeners.set(name,handler),
    fire:(name,event={}) => listeners.get(name)?.(event), contains:() => false,
    focus() { this.focused=true; }, querySelectorAll:() => []
  };
}
const scriptSource = readFileSync(resolve(root,'site.js'),'utf8');
function boot({ saved=null, storageThrows=false, systemDark=false }={}) {
  const root=element(), nav=element(), menu=element(), theme=element(), link=element(), doc=element();
  nav.querySelectorAll=() => [link];
  doc.documentElement=root;
  doc.querySelector=selector => ({'.nav-links':nav,'.nav-toggle':menu,'.theme-toggle':theme})[selector] ?? null;
  const preferences=new Map();
  const win={matchMedia(query) { const media=element(); media.matches=query.includes('prefers')&&systemDark; preferences.set(query,media); return media; }};
  const storage={ getItem() { if(storageThrows) throw Error('disabled'); return saved; }, setItem(key,value) { if(storageThrows) throw Error('disabled'); saved=value; } };
  vm.runInNewContext(scriptSource, {document:doc,window:win,localStorage:storage});
  return {root,nav,menu,theme,link,doc,preferences};
}
test('theme respects saved preferences, toggles, and survives disabled storage', () => {
  for (const storageThrows of [false,true]) {
    const {root,theme}=boot({storageThrows});
    assert.equal(root.getAttribute('data-theme'),'light');
    theme.fire('click');
    assert.equal(root.getAttribute('data-theme'),'dark');
    assert.equal(theme.getAttribute('aria-label'),'Switch to light mode');
  }
  assert.equal(boot({saved:'light',systemDark:true}).root.getAttribute('data-theme'),'light');
  assert.equal(boot({saved:'invalid',systemDark:true}).root.getAttribute('data-theme'),'dark');
});
test('system preference changes apply unless the visitor chose a theme', () => {
  const {root,theme,preferences}=boot();
  const system=preferences.get('(prefers-color-scheme: dark)');
  system.fire('change',{matches:true});
  assert.equal(root.getAttribute('data-theme'),'dark');
  theme.fire('click');
  system.fire('change',{matches:true});
  assert.equal(root.getAttribute('data-theme'),'light');
});
test('menu exposes expanded state and closes on Escape, destination, outside click, and desktop', () => {
  const {nav,menu,doc,link,preferences}=boot();
  menu.fire('click');
  assert.equal(menu.getAttribute('aria-expanded'),'true');
  assert.ok(nav.classList.contains('active'));
  doc.fire('keydown',{key:'Escape'});
  assert.equal(menu.getAttribute('aria-expanded'),'false');
  assert.ok(menu.focused);
  for (const close of [()=>link.fire('click'),()=>doc.fire('click',{target:{}}),()=>preferences.get('(min-width: 801px)').fire('change',{matches:true})]) {
    menu.fire('click'); close();
    assert.equal(menu.getAttribute('aria-expanded'),'false');
  }
});
test('portfolio focuses on inspectable projects, not employment history', () => {
  const html=documents.get('index.html');
  const work=html.slice(html.indexOf('<section id="projects"'),html.indexOf('<section id="about"'));
  for (const repo of ['k8s-observability-stack','k8s-cost-radar','eks-demo']) assert.ok(work.includes(`https://github.com/oginnidipo/${repo}`));
  assert.doesNotMatch(work,/70%|2,000|40%|Zero.*Downtime/);
  assert.match(work,/request-based resource costs/);
  assert.match(work,/Sample data from the repository/);
  assert.doesNotMatch(html,/Euna|BMO|Exodus|Busha|experience-section|career-strip|impact-panel|CERTIFICATIONS/);
  assert.equal((html.match(/href="resume.pdf"/g)||[]).length,1);
  assert.ok(html.indexOf('href="resume.pdf"') > html.indexOf('<footer'));
});
test('one sans-serif type system, with no external font requests', () => {
  const css=readFileSync(resolve(root,'styles.css'),'utf8');
  assert.match(css,/--font:-apple-system/);
  assert.doesNotMatch(css,/@import|Instrument|DM Sans|--serif/);
  for(const html of documents.values()) assert.doesNotMatch(html,/revamp\.css|fonts\.googleapis|fonts\.gstatic/);
});
test('brand wordmark and favicon set stay consistent', () => {
  const home=documents.get('index.html');
  assert.match(home,/dipo<span class="logo-slash">\/<\/span>ops<span class="logo-dot">\.<\/span>/);
  const svg=readFileSync(resolve(root,'favicon.svg'),'utf8');
  assert.match(svg,/fill="#10251e"/);
  assert.match(svg,/>d<tspan fill="#b8ee75">\/<\/tspan>o</);
  for(const html of documents.values()) {
    assert.match(html,/rel="icon" type="image\/svg\+xml"/);
    assert.match(html,/rel="icon" type="image\/png" sizes="32x32"/);
    assert.match(html,/rel="apple-touch-icon" sizes="180x180"/);
  }
});
test('social previews and existing résumé remain available', () => {
  for (const path of ['og-image.png','resume.pdf','assets/og/ai-platform-engineering.png','assets/og/cloud-cost-optimization.png','assets/og/kubernetes-production-readiness.png']) assert.ok(existsSync(resolve(root,path)));
  assert.match(documents.get('index.html'),/property="og:image" content="https:\/\/dipops.com\/og-image.png"/);
  assert.match(documents.get('index.html'),/rel="canonical" href="https:\/\/dipops.com\/"/);
});

test('article publication metadata agrees across pages, indexes and RSS', () => {
  const feed=readFileSync(resolve(root,'feed.xml'),'utf8');
  const items=[...feed.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(match=>match[1]);
  const home=documents.get('index.html'), index=documents.get('blog/index.html');
  for (const item of items) {
    const title=item.match(/<title>(.*?)<\/title>/)[1];
    const url=item.match(/<link>(.*?)<\/link>/)[1];
    const html=documents.get(new URL(url).pathname.slice(1));
    assert.ok(html,'RSS entry must point to a tested article');
    const metadata=JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
    assert.equal(metadata.headline,title);
    assert.ok(html.includes('<h1>'+title+'</h1>'));
    assert.ok(home.includes(title),'homepage article title differs');
    assert.ok(index.includes(title),'writing index article title differs');
    assert.equal(new Date(metadata.datePublished+'T00:00:00Z').toUTCString(),item.match(/<pubDate>(.*?)<\/pubDate>/)[1]);
    assert.ok(html.includes('datetime="'+metadata.datePublished+'"'));
    assert.ok(metadata.dateModified >= metadata.datePublished);
    const minutes=html.match(/\d+ min read/)[0];
    const slug=new URL(url).pathname.split('/').pop();
    const row=home.match(new RegExp('<a class="writing-row" href="blog/'+slug.replace('.', '\\.')+'">[\\s\\S]*?</a>'))[0];
    assert.ok(row.includes(minutes),'homepage reading time differs');
  }
});

test('every page counts visits, offers the theme toggle, and links to the domain sale page', () => {
  for (const [path, html] of documents) {
    assert.match(html,/<script src="[^"<>]*visits\.js" defer><\/script>/,`${path}: missing visits.js`);
    assert.match(html,/class="theme-toggle"/,`${path}: missing theme toggle`);
    assert.match(html,/<footer[\s\S]*href="[^"]*domain\.html" class="footer-domain">dipops\.com is for sale<\/a>/,`${path}: missing footer domain link`);
  }
});

test('no public file shadows the analytics Worker routes', () => {
  // workers/insights/wrangler.toml routes dipops.com/insights* and /api/ping to the Worker.
  for (const name of readdirSync(root)) assert.doesNotMatch(name,/^(insights|api$)/,`${name} would be served by the Worker, not GitHub Pages`);
});

test('every social preview image referenced by a page exists', () => {
  for (const [path, html] of documents) {
    for (const [,url] of html.matchAll(/(?:property="og:image"|name="twitter:image") content="https:\/\/dipops\.com\/([^"]+)"/g)) {
      assert.ok(existsSync(resolve(root,url)),`${path}: missing ${url}`);
    }
  }
});

test('social card text matches the pages it previews', async () => {
  const { CARDS } = await import('./generate-og-images.mjs');
  const pagesByCard = { 'assets/og/ai-platform-engineering.png':'blog/ai-platform-engineering.html',
    'assets/og/kubernetes-production-readiness.png':'blog/kubernetes-production-readiness.html',
    'assets/og/cloud-cost-optimization.png':'blog/cloud-cost-optimization.html' };
  for (const card of CARDS) {
    assert.ok(existsSync(resolve(root,card.file)),`run npm run og:build to create ${card.file}`);
    const page = pagesByCard[card.file];
    if (!page) continue;
    const html = documents.get(page);
    assert.ok(html.includes(`<h1>${card.title}</h1>`),`${card.file}: title differs from ${page}`);
    for (const detail of card.footer.slice(1)) assert.ok(html.includes(detail),`${card.file}: "${detail}" not found in ${page}`);
  }
});

test('the domain asking price is identical everywhere it appears', () => {
  const html=documents.get('domain.html');
  const amount=Number(html.match(/data-domain-price="(\d+)"/)[1]);
  const price=`US$${amount.toLocaleString('en-US')}`;
  assert.match(html,new RegExp(`data-domain-price="${amount}">${price.replace('$','\\$')}</p>`));
  const product=JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  assert.equal(Number(product.offers.price),amount);
  assert.equal(product.offers.priceCurrency,'USD');
  for (const label of ['<title>','name="description"','property="og:description"']) {
    const line=html.split('\n').find(text => text.includes(label));
    assert.ok(line.includes(price),`${label} must mention ${price}`);
  }
  const buy=html.match(/data-insights="domain-buy" href="([^"]+)"/)[1].replace(/&amp;/g,'&');
  const mail=new URL(buy);
  assert.equal(mail.protocol,'mailto:');
  assert.ok(mail.searchParams.get('subject').includes(price),'buy email subject price differs');
  assert.ok(mail.searchParams.get('body').includes(price),'buy email body price differs');
});

test('llms.txt lists every article and project page', () => {
  const llms=readFileSync(resolve(root,'llms.txt'),'utf8');
  const feed=readFileSync(resolve(root,'feed.xml'),'utf8');
  for (const [,title] of feed.matchAll(/<item>\s*<title>(.*?)<\/title>/g)) assert.ok(llms.includes(title),`llms.txt is missing "${title}"`);
  assert.ok(llms.includes('https://dipops.com/projects/k8s-cost-radar.html'));
  for (const rule of ['Disallow: /insights','Disallow: /api/']) assert.ok(readFileSync(resolve(root,'robots.txt'),'utf8').includes(rule));
});
