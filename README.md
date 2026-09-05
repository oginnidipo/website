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
- `npm test` checks markup, local links, metadata, theme behavior, and navigation logic.
- `npm run build` runs the checks and copies only public assets into `dist/`.

The site uses `styles.css` for a single system sans-serif type family, responsive layouts,
and the reading experience. Monospace is reserved for code and repository artifacts.
`site.js` handles accessible navigation and the theme preference. Employment history,
certification lists, and résumé-style metric panels are intentionally absent from the home page.
The résumé and existing social-preview image files are retained. Articles include source links and distinguish measured results from assumptions. The cost article omits its old sharing image because that image contains a claim no longer made in the text.

`projects/k8s-cost-radar.html` documents the public tool's implementation and limitations.
Project workflow diagrams describe architecture; they are not screenshots or live data.
ReceiptNest is the current name of the app formerly called ReceiptVault. Its public
support page is linked; neither app is presented as publicly downloadable without a
verified release link. Article titles, publication dates, and reading times must stay
consistent across article pages, the homepage, writing index, and RSS.

The `.openai/hosting.json` registration is for the separate private preview. The
public dipops.com domain remains on GitHub Pages. Pushes to `main` run the checks
and build with Node.js 22, then deploy only `dist/`, excluding development files
and preview configuration from the published website.
