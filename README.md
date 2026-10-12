# dipops.com

My personal portfolio — [dipops.com](https://dipops.com)

Static portfolio of software and infrastructure projects, with technical
notes and a short introduction. Plain HTML/CSS, hosted on GitHub Pages
with a custom domain.

## Stack

- HTML5 + CSS3, no frameworks
- GitHub Pages + custom domain
- SEO: Open Graph, JSON-LD, llms.txt

## Development

Requires Node.js 22+. The site has no runtime dependencies.

    npm run dev      # local preview at http://127.0.0.1:4173/
    npm test         # markup, links, metadata, navigation checks
    npm run build    # checks + copy public assets into dist/

Pushes to `main` build with Node.js 22 and deploy only `dist/`.

## Projects

- [k8s-cost-radar](https://github.com/oginnidipo/k8s-cost-radar) — Kubernetes resource & cost analysis CLI

## Privacy

Cookieless, privacy-first analytics: no cookies, no IPs, a visitor hash that
rotates daily. Operational details are kept internal.
