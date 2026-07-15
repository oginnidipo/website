#!/usr/bin/env node
// Generates Open Graph card images (1200x630 PNG) for the site and each blog post.
// Usage: node scripts/generate-og-images.mjs   (or: npm run og:build)
// Requires Chrome; override the binary with CHROME_BIN if needed.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "assets", "og");

const POSTS = [
  {
    slug: "ai-platform-engineering",
    title: "AI Platform Engineering: What Teams Need Before They Ship Agents",
    tags: ["AI Platform", "LLMOps", "SRE"],
    date: "May 10, 2026",
    readTime: "9 min read",
  },
  {
    slug: "kubernetes-production-readiness",
    title: "Kubernetes Production Readiness: What Actually Matters",
    tags: ["Kubernetes", "Production", "SRE"],
    date: "February 7, 2026",
    readTime: "8 min read",
  },
  {
    slug: "cloud-cost-optimization",
    title: "How I Cut Cloud Costs by 30% Without Sacrificing Performance",
    tags: ["FinOps", "AWS", "Cost Optimization"],
    date: "January 30, 2026",
    readTime: "10 min read",
  },
];

const LOGO_SVG = `
<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
  <g transform="translate(50, 54)">
    <rect x="-32" y="12" width="64" height="10" rx="2" fill="white" opacity="0.5"/>
    <rect x="-28" y="-2" width="56" height="10" rx="2" fill="white" opacity="0.7"/>
    <rect x="-24" y="-16" width="48" height="10" rx="2" fill="white" opacity="0.9"/>
    <g transform="translate(0, -30)">
      <circle cx="0" cy="0" r="4" fill="white"/>
      <line x1="0" y1="-8" x2="0" y2="-4" stroke="white" stroke-width="1.5" stroke-linecap="round"/>
      <line x1="6.9" y1="-4" x2="3.5" y2="-2" stroke="white" stroke-width="1.5" stroke-linecap="round"/>
      <line x1="6.9" y1="4" x2="3.5" y2="2" stroke="white" stroke-width="1.5" stroke-linecap="round"/>
      <line x1="0" y1="8" x2="0" y2="4" stroke="white" stroke-width="1.5" stroke-linecap="round"/>
      <line x1="-6.9" y1="4" x2="-3.5" y2="2" stroke="white" stroke-width="1.5" stroke-linecap="round"/>
      <line x1="-6.9" y1="-4" x2="-3.5" y2="-2" stroke="white" stroke-width="1.5" stroke-linecap="round"/>
      <circle cx="0" cy="-8" r="1.5" fill="white"/>
      <circle cx="6.9" cy="-4" r="1.5" fill="white"/>
      <circle cx="6.9" cy="4" r="1.5" fill="white"/>
      <circle cx="0" cy="8" r="1.5" fill="white"/>
      <circle cx="-6.9" cy="4" r="1.5" fill="white"/>
      <circle cx="-6.9" cy="-4" r="1.5" fill="white"/>
    </g>
  </g>
</svg>`;

const BASE_CSS = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 1200px; height: 630px; overflow: hidden; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background: #0f172a;
    color: #e2e8f0;
    position: relative;
  }
  .glow-1 {
    position: absolute; top: -180px; right: -120px;
    width: 520px; height: 520px; border-radius: 50%;
    background: radial-gradient(circle, rgba(37,99,235,0.35) 0%, rgba(37,99,235,0) 70%);
  }
  .glow-2 {
    position: absolute; bottom: -220px; left: -100px;
    width: 560px; height: 560px; border-radius: 50%;
    background: radial-gradient(circle, rgba(6,182,212,0.22) 0%, rgba(6,182,212,0) 70%);
  }
  .grid-lines {
    position: absolute; inset: 0;
    background-image:
      linear-gradient(rgba(148,163,184,0.05) 1px, transparent 1px),
      linear-gradient(90deg, rgba(148,163,184,0.05) 1px, transparent 1px);
    background-size: 48px 48px;
  }
  .content {
    position: relative;
    padding: 78px 90px;
    height: 100%;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
  }
  .top { display: flex; align-items: center; gap: 20px; }
  .logo {
    width: 56px; height: 56px; border-radius: 13px;
    background: linear-gradient(135deg, #2563eb, #1e40af);
    display: flex; align-items: center; justify-content: center;
    flex-shrink: 0;
  }
  .logo svg { width: 36px; height: 36px; }
  .site { font-size: 24px; font-weight: 600; color: #94a3b8; letter-spacing: 0.01em; }
  .eyebrow {
    font-size: 22px; font-weight: 600; letter-spacing: 0.14em;
    text-transform: uppercase; color: #60a5fa; margin-bottom: 22px;
  }
  h1 { font-weight: 800; letter-spacing: -0.03em; color: #f8fafc; }
`;

function siteCard() {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>${BASE_CSS}
  .middle { margin-top: -10px; }
  h1 { font-size: 92px; line-height: 1.02; margin-bottom: 26px; }
  .tagline { font-size: 32px; color: #94a3b8; letter-spacing: -0.01em; max-width: 860px; line-height: 1.35; }
  .stats { display: flex; gap: 64px; align-items: flex-end; }
  .stat .num { font-size: 44px; font-weight: 750; color: #60a5fa; letter-spacing: -0.02em; }
  .stat .label { font-size: 19px; color: #64748b; margin-top: 6px; font-weight: 500; }
  .divider { width: 1px; height: 62px; background: #1e293b; }
  </style></head><body>
  <div class="glow-1"></div><div class="glow-2"></div><div class="grid-lines"></div>
  <div class="content">
    <div class="top"><div class="logo">${LOGO_SVG}</div><div class="site">dipops.com</div></div>
    <div class="middle">
      <div class="eyebrow">AI Platform Engineer &middot; Senior SRE &middot; Toronto</div>
      <h1>Dipo Oginni</h1>
      <div class="tagline">Turning AI experiments into production-grade infrastructure leverage.</div>
    </div>
    <div class="stats">
      <div class="stat"><div class="num">70%</div><div class="label">MTTD Reduction</div></div>
      <div class="divider"></div>
      <div class="stat"><div class="num">20%</div><div class="label">Cloud Savings</div></div>
      <div class="divider"></div>
      <div class="stat"><div class="num">2,000+</div><div class="label">Servers Automated</div></div>
    </div>
  </div>
  </body></html>`;
}

function postCard({ title, tags, date, readTime }) {
  const titleSize = title.length > 58 ? 62 : 70;
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>${BASE_CSS}
  h1 { font-size: ${titleSize}px; line-height: 1.12; max-width: 1010px; }
  .bottom { display: flex; align-items: center; gap: 16px; }
  .author { font-size: 26px; font-weight: 650; color: #e2e8f0; }
  .meta { font-size: 24px; color: #64748b; font-weight: 500; }
  .dot { width: 4px; height: 4px; border-radius: 50%; background: #475569; }
  </style></head><body>
  <div class="glow-1"></div><div class="glow-2"></div><div class="grid-lines"></div>
  <div class="content">
    <div class="top"><div class="logo">${LOGO_SVG}</div><div class="site">dipops.com/blog</div></div>
    <div class="middle">
      <div class="eyebrow">${tags.map(esc).join(" &middot; ")}</div>
      <h1>${esc(title)}</h1>
    </div>
    <div class="bottom">
      <span class="author">Dipo Oginni</span>
      <span class="dot"></span>
      <span class="meta">${esc(date)}</span>
      <span class="dot"></span>
      <span class="meta">${esc(readTime)}</span>
    </div>
  </div>
  </body></html>`;
}

function findChrome() {
  if (process.env.CHROME_BIN) return process.env.CHROME_BIN;
  const candidates = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
  ];
  const found = candidates.find((p) => existsSync(p));
  if (!found) throw new Error("Chrome not found — set CHROME_BIN to your Chrome/Chromium binary.");
  return found;
}

function render(chrome, html, outPath) {
  const tmpHtml = join(tmpdir(), `og-${Date.now()}-${Math.random().toString(36).slice(2)}.html`);
  writeFileSync(tmpHtml, html);
  try {
    execFileSync(chrome, [
      "--headless=new", "--disable-gpu", "--hide-scrollbars",
      "--force-device-scale-factor=1", "--window-size=1200,630",
      `--screenshot=${outPath}`, `file://${tmpHtml}`,
    ], { stdio: "pipe" });
  } finally {
    rmSync(tmpHtml, { force: true });
  }
  console.log(`✓ ${outPath}`);
}

const chrome = findChrome();
mkdirSync(OUT_DIR, { recursive: true });
render(chrome, siteCard(), join(ROOT, "og-image.png"));
for (const post of POSTS) {
  render(chrome, postCard(post), join(OUT_DIR, `${post.slug}.png`));
}
