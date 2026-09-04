# dipops.com

My personal portfolio — [dipops.com](https://dipops.com)

Static site showcasing my work as a Staff Platform Engineer, Senior SRE, and AI infrastructure practitioner. Built with plain HTML/CSS and hosted on GitHub Pages.

## Stack

- HTML5 + CSS3 (no frameworks)
- GitHub Pages + custom domain
- SEO-optimized with Open Graph, JSON-LD structured data
- Recruiter-focused positioning, quantified outcomes, and clear work-authorization context
- Platform/SRE case studies, production-AI operating model, and technical writing

## Development

Requires Node.js 22 or newer. The portfolio itself has no runtime dependencies.

- `npm run dev` serves a local preview at http://127.0.0.1:4173/ (refresh to see edits).
- `npm test` checks markup, local links, metadata, theme behavior, and navigation logic.
- `npm run build` runs the checks and copies only public assets into `dist/`.

The editorial redesign uses `revamp.css` for shared design tokens, responsive layouts,
and the reading experience. `site.js` handles accessible navigation and the theme preference.
Career outcomes are distinct from the public reference implementations linked in Selected Work.
The résumé, article content, and existing social-preview images are preserved.

The `.openai/hosting.json` registration is for the private redesign preview. It does
not change the dipops.com domain or GitHub Pages deployment. Publishing to GitHub
Pages remains an explicit follow-up action after review.
