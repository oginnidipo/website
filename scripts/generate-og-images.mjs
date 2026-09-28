#!/usr/bin/env node
// Generates the 1200x630 social preview cards (Open Graph / X) for the site, articles, and pages.
// Usage: npm run og:build. Requires Chrome; set CHROME_BIN to use another Chrome/Chromium binary.
// Card text must match the pages it previews: titles, dates, and reading times (checked by npm test).

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export const CARDS = [
  {
    file: "og-image.png",
    kind: "hero",
    eyebrow: "Platform engineering & SRE · Ontario, Canada",
    title: "Dipo Oginni",
    subtitle: "Infrastructure tools, observability, and notes on running reliable systems.",
    footer: ["k8s-cost-radar", "Kubernetes observability stack", "EKS foundation"],
  },
  {
    file: "assets/og/ai-platform-engineering.png",
    eyebrow: "AI Platform Engineering",
    title: "AI Platform Engineering: What Teams Need Before They Ship Agents",
    footer: ["Dipo Oginni", "May 10, 2026", "3 min read"],
  },
  {
    file: "assets/og/kubernetes-production-readiness.png",
    eyebrow: "SRE",
    title: "Kubernetes Production Readiness: What Actually Matters",
    footer: ["Dipo Oginni", "February 7, 2026", "3 min read"],
  },
  {
    file: "assets/og/cloud-cost-optimization.png",
    eyebrow: "FinOps",
    title: "Cloud Cost Optimization: Measure Before You Resize",
    footer: ["Dipo Oginni", "January 30, 2026", "3 min read"],
  },
  {
    file: "assets/og/k8s-cost-radar.png",
    eyebrow: "Project notes · Python & Kubernetes",
    title: "k8s-cost-radar",
    subtitle: "Making a cluster’s declared resource costs easier to investigate.",
    footer: ["Dipo Oginni", "Open source on GitHub"],
  },
  {
    file: "assets/og/domain.png",
    kind: "domain",
    eyebrow: "Domain name for sale",
    title: "dipops.com",
    subtitle: "A short, six-letter .com. Buy it now or make an offer.",
    footer: ["Secure transfer through Escrow.com"],
  },
];

const esc = value => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function cardHtml(card) {
  const titleSize = card.kind === "hero" ? 104 : card.kind === "domain" ? 132 : card.title.length > 58 ? 64 : card.title.length > 30 ? 72 : 96;
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
  * { margin:0; padding:0; box-sizing:border-box; }
  html, body { width:1200px; height:630px; overflow:hidden; }
  body { font-family:-apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif; background:#10251e; color:#f7faf8; position:relative; }
  .grid { position:absolute; inset:0; background-image:linear-gradient(rgba(184,238,117,.045) 1px, transparent 1px), linear-gradient(90deg, rgba(184,238,117,.045) 1px, transparent 1px); background-size:44px 44px; }
  .glow { position:absolute; top:-260px; right:-160px; width:640px; height:640px; border-radius:50%; background:radial-gradient(circle, rgba(184,238,117,.20) 0%, rgba(184,238,117,0) 68%); }
  .rule { position:absolute; left:0; top:0; bottom:0; width:10px; background:#b8ee75; }
  .content { position:relative; height:100%; padding:72px 88px 70px 98px; display:flex; flex-direction:column; justify-content:space-between; }
  .brand { font-size:34px; font-weight:700; letter-spacing:-.04em; }
  .brand span { color:#b8ee75; }
  .eyebrow { font-size:23px; font-weight:600; letter-spacing:.12em; text-transform:uppercase; color:#b8ee75; margin-bottom:22px; }
  h1 { font-size:${titleSize}px; font-weight:750; letter-spacing:-.035em; line-height:1.06; max-width:1000px; }
  .subtitle { font-size:31px; color:#c6d2cd; line-height:1.35; margin-top:24px; max-width:900px; }
  .footer { display:flex; align-items:center; gap:18px; font-size:24px; color:#9fb3aa; font-weight:500; }
  .footer .dot { width:5px; height:5px; border-radius:50%; background:#4c6b5f; }
  .footer .first { color:#f7faf8; font-weight:650; }
  </style></head><body>
  <div class="grid"></div><div class="glow"></div><div class="rule"></div>
  <div class="content">
    <div class="brand">dipo<span>/</span>ops<span>.</span></div>
    <div>
      <div class="eyebrow">${esc(card.eyebrow)}</div>
      <h1>${esc(card.title)}</h1>
      ${card.subtitle ? `<p class="subtitle">${esc(card.subtitle)}</p>` : ""}
    </div>
    <div class="footer">${card.footer.map((item, index) => `${index ? '<span class="dot"></span>' : ""}<span class="${index === 0 ? "first" : ""}">${esc(item)}</span>`).join("")}</div>
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
  const found = candidates.find(path => existsSync(path));
  if (!found) throw new Error("Chrome not found — set CHROME_BIN to your Chrome/Chromium binary.");
  return found;
}

function render(chrome, card) {
  const output = join(ROOT, card.file);
  const page = join(tmpdir(), `og-${process.pid}-${Math.random().toString(36).slice(2)}.html`);
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(page, cardHtml(card));
  try {
    execFileSync(chrome, [
      "--headless=new", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1",
      "--window-size=1200,630", `--screenshot=${output}`, `file://${page}`,
    ], { stdio: "pipe" });
  } finally {
    rmSync(page, { force: true });
  }
  console.log(`✓ ${card.file}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const chrome = findChrome();
  for (const card of CARDS) render(chrome, card);
}
