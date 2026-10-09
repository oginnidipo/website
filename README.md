# dipops.com

My personal portfolio — [dipops.com](https://dipops.com)

Static portfolio of software and infrastructure projects, with technical notes and a short introduction. Built with plain HTML/CSS and hosted on GitHub Pages.

## Stack

- HTML5 + CSS3 (no frameworks)
- GitHub Pages + custom domain
- SEO-optimized with Open Graph, JSON-LD structured data
- Project-first home page with repository examples and direct source links
- Technical writing, personal projects, and a secondary résumé link

## Development

Requires Node.js 22 or newer. The portfolio itself has no runtime dependencies.

- `npm run dev` serves a local preview at http://127.0.0.1:4173/ (refresh to see edits).
- `npm test` checks markup, local links, metadata, theme behavior, navigation logic, and the analytics Worker.
- `npm run build` runs the checks and copies only public assets into `dist/`.
- `npm run og:build` regenerates the social preview cards from `scripts/generate-og-images.mjs` (needs Chrome).

The site uses `styles.css` for a single system sans-serif type family, responsive layouts,
and the reading experience. Monospace is reserved for code and repository artifacts.
`site.js` handles accessible navigation and the theme preference. Employment history,
certification lists, and résumé-style metric panels are intentionally absent from the home page.
The résumé is retained. Articles include source links and distinguish measured results from assumptions.
Social preview cards carry titles and dates only, never metrics; `npm test` checks that card text matches its page.
`llms.txt` summarizes the site for AI assistants and must list every article.

## Visit analytics

`visits.js` sends page views, key clicks (résumé, email, GitHub, LinkedIn, outbound links, domain
inquiries), and visible reading time to a Cloudflare Worker in `workers/insights/`, which stores
them in D1 and serves a password-protected dashboard at https://dipops.com/insights. No cookies
and no IP addresses are stored; a visitor is a hash that changes every day. The dashboard shows the
network a visit came from (company and university names, or the visitor's internet provider),
location, arrival source and `utm_campaign`, the pages viewed in order, and what was clicked.

The Worker, its D1 database (id in `workers/insights/wrangler.toml`), and the tables are deployed on
`dipops.com/api/ping` and `dipops.com/insights*`. After that:

- `npx wrangler secret put DASHBOARD_PASSWORD -c workers/insights/wrangler.toml` sets or changes the dashboard password.
- `npm run insights:deploy` publishes Worker code changes; add a file under `workers/insights/migrations/` and run `npm run insights:migrate` for schema changes.
- Open https://dipops.com/?no-insights once in each of your browsers so your own visits are not counted.
- `npm run insights:snapshot` saves the dashboard from the live database and opens it, without the password
  (read-only, through your Wrangler login). Add `-- --days 7` for another range; files go to a temp folder, not the repo.

Dashboard sign-in allows 5 password checks per client every 15 minutes and 50 per hour in total;
further attempts get HTTP 429 with a `Retry-After` and are never checked against the password.

No public file may start with `/insights` or `/api/ping`, because those paths go to the Worker.
Add `?utm_source=linkedin&utm_campaign=<name>` to links you share to see which ones bring visitors.
Locally, `npm run insights:dev` runs the Worker with a local database and `workers/insights/.dev.vars`;
set `localStorage['dipops:insights-endpoint']` to `http://127.0.0.1:8787/api/ping` in the preview to send it events.

## Receipt AI endpoint

The `api.dipops.com/receipt-ai` endpoint behind Nestfold's AI cleanup lives in the Nestfold repo (`backend/receipt-ai-proxy`), not here; never deploy it from this repo.

## Domain sale

`domain.html` lists dipops.com for sale with an asking price, prefilled email links for buying or
making an offer, and an Escrow.com purchase process. Every page links to it from the footer. To
change the price, edit `data-domain-price`, the displayed price, the JSON-LD offer, the title and
descriptions, and the buy email in `domain.html`; `npm test` fails if any of them disagree.

`projects/k8s-cost-radar.html` documents the public tool's implementation and limitations.
Project workflow diagrams describe architecture; they are not screenshots or live data.
Nestfold is the current name of the app formerly called ReceiptNest (and before that
ReceiptVault). Its public site, nestfold.dipops.com, is linked; neither app is presented
as publicly downloadable without a verified release link. Article titles, publication dates, and reading times must stay
consistent across article pages, the homepage, writing index, and RSS.

The `.openai/hosting.json` registration is for the separate private preview. The
public dipops.com domain remains on GitHub Pages. Pushes to `main` run the checks
and build with Node.js 22, then deploy only `dist/`, excluding development files
and preview configuration from the published website.
