import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';

const root = resolve(import.meta.dirname, '..');
const pages = ['index.html','now.html','404.html','blog/index.html','blog/ai-platform-engineering.html',
  'blog/kubernetes-production-readiness.html','blog/cloud-cost-optimization.html'];
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
test('career outcomes stay distinct from public project implementations', () => {
  const html=documents.get('index.html');
  const work=html.slice(html.indexOf('<section id="projects"'),html.indexOf('<section id="experience"'));
  for (const repo of ['k8s-observability-stack','k8s-cost-radar','eks-demo']) assert.ok(work.includes(`https://github.com/oginnidipo/${repo}`));
  assert.doesNotMatch(work,/70%|2,000|40%|Zero.*Downtime/);
  assert.match(work,/request-based resource costs/);
});
test('social previews and existing résumé remain available', () => {
  for (const path of ['og-image.png','resume.pdf','assets/og/ai-platform-engineering.png','assets/og/cloud-cost-optimization.png','assets/og/kubernetes-production-readiness.png']) assert.ok(existsSync(resolve(root,path)));
  assert.match(documents.get('index.html'),/property="og:image" content="https:\/\/dipops.com\/og-image.png"/);
  assert.match(documents.get('index.html'),/rel="canonical" href="https:\/\/dipops.com\/"/);
});
