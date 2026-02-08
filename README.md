# Dipo Oginni — Portfolio Website

Personal portfolio and blog for Dipo Oginni, Senior Platform Engineer & SRE.

🌐 **Live site:** [dipops.com](https://dipops.com)

## About

This is a static portfolio site showcasing platform engineering and SRE expertise, including:

- Professional experience and key achievements
- Technical skills (Kubernetes, Terraform, AWS/Azure, GitOps, observability)
- Project highlights
- Blog posts on cloud infrastructure topics

## Structure

```
website/
├── index.html          # Main portfolio page
├── styles.css          # Stylesheet
├── favicon.svg         # Site favicon
└── blog/
    ├── index.html      # Blog listing page
    ├── cloud-cost-optimization.html
    └── kubernetes-production-readiness.html
```

## Tech Stack

- Plain HTML + CSS (no framework, no dependencies)
- Fully static — zero build step required
- Mobile responsive

## Blog Topics

- Cloud cost optimization and FinOps practices
- Kubernetes production readiness
- Platform engineering patterns

## Local Development

No build tools needed. Just open `index.html` in a browser or serve with any static file server:

```bash
# Python
python3 -m http.server 8080

# Node
npx serve .
```

## License

MIT
