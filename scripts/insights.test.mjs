import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import worker, { normalizeEvent, classifySource, parseUserAgent, isBot, classifyOrg, csvCell, escapeHtml,
  visitorId, authorized, renderDashboard } from '../workers/insights/worker.mjs';

const root = resolve(import.meta.dirname, '..');
const SAFARI = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

test('events are validated and normalized before storage', () => {
  const view = normalizeEvent({ t:'pageview', p:'/blog/index.html?x=1#top', r:'https://www.linkedin.com/feed/?trk=abc', l:'en-CA', u:{ source:'linkedin', campaign:'job-search' } });
  assert.equal(view.path,'/blog/');
  assert.equal(view.referrer,'https://www.linkedin.com/feed/');
  assert.equal(view.utm.campaign,'job-search');
  assert.equal(normalizeEvent({ t:'drop', p:'/' }),null);
  assert.equal(normalizeEvent({ t:'pageview', p:'//evil.example/' }),null);
  assert.equal(normalizeEvent({ t:'pageview', p:'https://evil.example/' }),null);
  assert.equal(normalizeEvent({ t:'action', p:'/', a:'<script>' }),null);
  assert.equal(normalizeEvent({ t:'action', p:'/', a:'resume', h:'https://dipops.com/resume.pdf' }).label,'resume');
  assert.equal(normalizeEvent({ t:'action', p:'/', a:'email', h:'mailto:coginni@gmail.com?subject=Hi' }).target,'mailto:coginni@gmail.com');
  assert.equal(normalizeEvent({ t:'engage', p:'/', s:95 }).seconds,95);
  for (const s of [0, 1801, 'abc']) assert.equal(normalizeEvent({ t:'engage', p:'/', s }),null);
  assert.equal(normalizeEvent({ t:'engage', p:'/', s:30, r:'https://google.com/' }).referrer,null,'only page views carry a referrer');
});

test('arrivals are attributed to a readable source', () => {
  const own = new Set(['dipops.com']);
  assert.deepEqual(classifySource('https://www.google.com/',null,own),{ source:'Google', referrer:'https://www.google.com/' });
  assert.equal(classifySource('https://gemini.google.com/app',null,own).source,'Gemini');
  assert.equal(classifySource('https://lnkd.in/abc',null,own).source,'LinkedIn');
  assert.equal(classifySource('https://news.ycombinator.com/item',null,own).source,'Hacker News');
  assert.equal(classifySource('https://chatgpt.com/',null,own).source,'ChatGPT');
  assert.equal(classifySource('https://www.dipops.com/blog/',null,own).source,'internal');
  assert.equal(classifySource('',null,own).source,'Direct');
  assert.equal(classifySource('','linkedin',own).source,'LinkedIn');
  assert.equal(classifySource('','twitter',own).source,'X');
  assert.equal(classifySource('','conference-talk',own).source,'conference-talk');
  assert.equal(classifySource('https://blog.example.org/post',null,own).source,'blog.example.org');
});

test('user agents are summarized and bots are ignored', () => {
  assert.deepEqual(parseUserAgent(IPHONE),{ device:'Mobile', browser:'Safari', os:'iOS' });
  assert.deepEqual(parseUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36 Edg/129.0'),{ device:'Desktop', browser:'Edge', os:'Windows' });
  assert.equal(parseUserAgent('Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36').device,'Tablet');
  for (const agent of ['', 'Mozilla/5.0 (compatible; Googlebot/2.1)', 'Mozilla/5.0 HeadlessChrome/129.0', 'curl/8.4.0', 'python-requests/2.32']) assert.ok(isBot(agent),agent);
  assert.equal(isBot(SAFARI),false);
});

test('networks are grouped into organizations, providers, and hosting', () => {
  for (const org of ['Shopify Inc.','University of Waterloo','Microsoft Corporation','Royal Bank of Canada']) assert.equal(classifyOrg(org),'org',org);
  for (const org of ['Rogers Communications Canada Inc.','Bell Canada','TELUS Communications Inc.','Comcast Cable Communications, LLC','Distributel Communications Limited']) assert.equal(classifyOrg(org),'isp',org);
  for (const org of ['Amazon.com, Inc.','DigitalOcean, LLC','Zscaler, Inc.','Hetzner Online GmbH']) assert.equal(classifyOrg(org),'hosting',org);
});

test('exports and the dashboard neutralize untrusted values', () => {
  assert.equal(csvCell('=HYPERLINK("x")'),`"'=HYPERLINK(""x"")"`);
  assert.equal(csvCell(null),'');
  assert.equal(escapeHtml('<img src=x onerror="a">'),'&lt;img src=x onerror=&quot;a&quot;&gt;');
  const evil = '<script>alert(1)</script>';
  const html = renderDashboard({
    summary:{ visits:1, views:1, actions:1, seconds:40 }, daily:[{ day:'2026-09-28', visits:1 }],
    pages:[{ path:evil, views:1, visits:1, seconds:40 }], sources:[{ name:evil, visits:1 }], referrers:[{ name:evil, visits:1 }],
    campaigns:[{ name:evil, visits:1 }], orgs:[{ name:evil, visits:1, views:1, last:Date.parse('2026-09-28T12:00:00Z') }],
    places:[{ country:'CA', city:evil, visits:1 }], actions:[{ name:evil, clicks:1, visits:1 }], devices:[{ name:evil, visits:1 }],
    browsers:[{ name:evil, visits:1 }],
    visits:[{ pages:[evil], actions:[evil], seconds:40, first:1, last:Date.parse('2026-09-28T12:00:00Z'), source:evil, org:evil, place:{ country:'CA', city:evil }, device:evil }]
  }, { days:'7', timeZone:'America/Toronto', now:Date.parse('2026-09-28T12:00:00Z') });
  assert.ok(!html.includes('<script>'),'raw script tag leaked into the dashboard');
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
});

test('visitor hashes are short, stable within a day, and change with the salt', async () => {
  const a = await visitorId('salt-a','203.0.113.9',SAFARI);
  assert.match(a,/^[0-9a-f]{16}$/);
  assert.equal(a,await visitorId('salt-a','203.0.113.9',SAFARI));
  assert.notEqual(a,await visitorId('salt-b','203.0.113.9',SAFARI));
});

test('dashboard password check accepts only the configured password', async () => {
  const request = password => new Request('https://dipops.com/insights',{ headers:{ Authorization:`Basic ${btoa(`owner:${password}`)}` } });
  assert.equal(await authorized(request('correct horse'),'correct horse'),true);
  assert.equal(await authorized(request('wrong'),'correct horse'),false);
  assert.equal(await authorized(new Request('https://dipops.com/insights'),'correct horse'),false);
});

function fakeDatabase() {
  const calls = [];
  const db = {
    calls,
    prepare(sql) {
      const statement = { sql, values:[],
        bind(...values) { statement.values = values; return statement; },
        async run() { calls.push({ sql, values:statement.values }); return { success:true }; },
        async first() { calls.push({ sql, values:statement.values }); return { salt:'stored-salt' }; } };
      return statement;
    }
  };
  return db;
}

test('the Worker records valid page views without storing the IP address', async () => {
  const db = fakeDatabase();
  const env = { DB:db, ALLOWED_ORIGINS:'https://dipops.com,https://www.dipops.com' };
  const pending = [];
  const ctx = { waitUntil:promise => pending.push(promise) };
  const ping = (body, headers={}) => worker.fetch(new Request('https://dipops.com/api/ping',{ method:'POST', body:JSON.stringify(body),
    headers:{ Origin:'https://dipops.com', 'User-Agent':SAFARI, 'CF-Connecting-IP':'198.51.100.23', ...headers } }), env, ctx);

  assert.equal((await worker.fetch(new Request('https://dipops.com/api/ping'), env, ctx)).status,405);
  assert.equal((await ping({ t:'pageview', p:'/' },{ Origin:'https://evil.example' })).status,403);
  assert.equal((await ping({ t:'pageview', p:'/' },{ 'User-Agent':'Googlebot/2.1' })).status,204);
  assert.equal((await ping({ t:'nope', p:'/' })).status,400);
  assert.equal(pending.length,0,'rejected and bot requests must not be stored');

  const response = await ping({ t:'pageview', p:'/index.html', r:'https://www.google.com/', l:'en-CA', u:{} });
  assert.equal(response.status,204);
  await Promise.all(pending);
  const insert = db.calls.find(call => call.sql.includes('INSERT INTO events'));
  assert.ok(insert,'event was not inserted');
  assert.equal(insert.values[3],'pageview');
  assert.equal(insert.values[4],'/');
  assert.equal(insert.values[8],'Google');
  assert.ok(!insert.values.includes('198.51.100.23'),'IP address must never be stored');
  assert.match(insert.values[2],/^[0-9a-f]{16}$/);
});

test('the dashboard is closed until a password is configured and supplied', async () => {
  const request = new Request('https://dipops.com/insights');
  assert.equal((await worker.fetch(request,{ DB:fakeDatabase() },{})).status,503);
  const locked = await worker.fetch(request,{ DB:fakeDatabase(), DASHBOARD_PASSWORD:'secret' },{});
  assert.equal(locked.status,401);
  assert.match(locked.headers.get('WWW-Authenticate'),/^Basic /);
});

// Browser script: run visits.js against a minimal fake page.
const clientSource = readFileSync(resolve(root,'visits.js'),'utf8');
class FakeElement {}
function link(href, dataset = {}) {
  const url = new URL(href,'https://dipops.com/');
  return Object.assign(new FakeElement(),{ href:url.href, protocol:url.protocol, host:url.host, hostname:url.hostname, pathname:url.pathname,
    dataset, closest() { return this; } });
}
function runClient({ url='https://dipops.com/', referrer='', storage={}, gpc=false, webdriver=false }={}) {
  const location = new URL(url);
  const clock = { now:1_000_000 };
  const sent = [], documentListeners = {}, windowListeners = {};
  const document = { referrer, visibilityState:'visible', addEventListener:(name, handler) => { documentListeners[name] = handler; } };
  const navigator = { language:'en-CA', webdriver, globalPrivacyControl:gpc, sendBeacon:(endpoint, body) => { sent.push({ endpoint, ...JSON.parse(body) }); return true; } };
  const localStorage = { getItem:key => storage[key] ?? null, setItem:(key, value) => { storage[key] = String(value); }, removeItem:key => { delete storage[key]; } };
  vm.runInNewContext(clientSource,{ location, document, navigator, localStorage, URLSearchParams, Element:FakeElement, JSON, Date:{ now:() => clock.now },
    addEventListener:(name, handler) => { windowListeners[name] = handler; }, fetch:() => Promise.resolve() });
  return { sent, storage, document, clock, click:target => documentListeners.click?.({ target }), hide() { document.visibilityState = 'hidden'; documentListeners.visibilitychange?.(); } };
}

test('visits.js sends a page view with referrer and campaign on dipops.com only', () => {
  const live = runClient({ url:'https://dipops.com/blog/?utm_source=linkedin&utm_campaign=job-search', referrer:'https://www.linkedin.com/' });
  assert.equal(live.sent.length,1);
  assert.deepEqual(live.sent[0],{ endpoint:'/api/ping', p:'/blog/', l:'en-CA', t:'pageview', r:'https://www.linkedin.com/', u:{ source:'linkedin', campaign:'job-search' } });
  assert.equal(runClient({ url:'http://127.0.0.1:4173/' }).sent.length,0,'local previews must not count');
  const tested = runClient({ url:'http://127.0.0.1:4173/', storage:{ 'dipops:insights-endpoint':'http://127.0.0.1:8787/api/ping' } });
  assert.equal(tested.sent[0].endpoint,'http://127.0.0.1:8787/api/ping');
});

test('visits.js respects the owner opt-out, Global Privacy Control, and automation', () => {
  const optOut = runClient({ url:'https://dipops.com/?no-insights' });
  assert.equal(optOut.sent.length,0);
  assert.equal(optOut.storage['dipops:no-insights'],'1');
  assert.equal(runClient({ storage:{ 'dipops:no-insights':'1' } }).sent.length,0);
  const back = runClient({ url:'https://dipops.com/?insights-on', storage:{ 'dipops:no-insights':'1' } });
  assert.equal(back.sent.length,1);
  assert.equal(runClient({ gpc:true }).sent.length,0);
  assert.equal(runClient({ webdriver:true }).sent.length,0);
});

test('visits.js labels the clicks that matter and reports reading time', () => {
  const page = runClient();
  page.click(link('/resume.pdf'));
  page.click(link('mailto:coginni@gmail.com'));
  page.click(link('https://github.com/oginnidipo'));
  page.click(link('https://www.linkedin.com/in/dipo-oginni'));
  page.click(link('https://docs.aws.amazon.com/'));
  page.click(link('mailto:coginni@gmail.com?subject=Offer',{ insights:'domain-offer' }));
  page.click(link('/blog/'));
  assert.deepEqual(page.sent.filter(event => event.t === 'action').map(event => event.a),['resume','email','github','linkedin','outbound','domain-offer']);
  page.clock.now += 400;
  page.hide();
  assert.equal(page.sent.find(event => event.t === 'engage'),undefined,'under one second of reading is not reported');
  const reader = runClient({ url:'https://dipops.com/blog/cloud-cost-optimization.html' });
  reader.clock.now += 42_400;
  reader.hide();
  assert.deepEqual(reader.sent.at(-1),{ endpoint:'/api/ping', p:'/blog/cloud-cost-optimization.html', l:'en-CA', t:'engage', s:42 });
  reader.hide();
  assert.equal(reader.sent.filter(event => event.t === 'engage').length,1,'time is reported once, not double-counted');
});
