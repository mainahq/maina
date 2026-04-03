# Docs, Landing Page & npm Publish — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an Astro Starlight docs site with a custom AI-startup landing page, deploy to GitHub Pages, and prepare npm publishing via changesets.

**Architecture:** New `packages/docs` workspace using Astro + Starlight. Custom landing page at `/` (pure Astro, no Starlight chrome). Docs at `/docs/*` via Starlight with sidebar, search, dark/light toggle. Golden spiral mynah SVG as logo. Two GitHub Actions workflows: one for docs deploy, one for npm release.

**Tech Stack:** Astro 5.x, @astrojs/starlight, MDX, GitHub Actions, changesets

---

### Task 1: Scaffold packages/docs workspace

**Files:**
- Create: `packages/docs/package.json`
- Create: `packages/docs/astro.config.mjs`
- Create: `packages/docs/tsconfig.json`
- Create: `packages/docs/src/content.config.ts`

- [ ] **Step 1: Create package.json**

Create `packages/docs/package.json`:

```json
{
  "name": "@maina/docs",
  "version": "0.1.0",
  "type": "module",
  "private": true,
  "license": "Apache-2.0",
  "description": "Maina documentation site — built with Astro Starlight",
  "scripts": {
    "dev": "astro dev",
    "build": "astro build",
    "preview": "astro preview",
    "typecheck": "astro check"
  },
  "dependencies": {
    "astro": "^5.9.4",
    "@astrojs/starlight": "^0.35.2",
    "sharp": "^0.33.5"
  },
  "devDependencies": {
    "@astrojs/check": "^0.10.0",
    "typescript": "^5.8.3"
  }
}
```

- [ ] **Step 2: Create astro.config.mjs**

Create `packages/docs/astro.config.mjs`:

```javascript
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  site: 'https://beeeku.github.io',
  base: '/maina',
  integrations: [
    starlight({
      title: 'Maina',
      logo: {
        src: './src/assets/mynah.svg',
        replacesTitle: false,
      },
      social: [
        {
          icon: 'github',
          label: 'GitHub',
          href: 'https://github.com/beeeku/maina',
        },
      ],
      editLink: {
        baseUrl: 'https://github.com/beeeku/maina/edit/master/packages/docs/',
      },
      sidebar: [
        {
          label: 'Start Here',
          items: [
            { slug: 'docs/getting-started' },
            { slug: 'docs/commands' },
          ],
        },
        {
          label: 'Reference',
          items: [
            { slug: 'docs/configuration' },
            { slug: 'docs/mcp' },
            { slug: 'docs/skills' },
          ],
        },
        {
          label: 'Engines',
          items: [
            { slug: 'docs/engines/context' },
            { slug: 'docs/engines/prompt' },
            { slug: 'docs/engines/verify' },
          ],
        },
        {
          label: 'Roadmap',
          items: [
            { slug: 'docs/roadmap' },
          ],
        },
      ],
      customCss: ['./src/styles/custom.css'],
    }),
  ],
});
```

- [ ] **Step 3: Create tsconfig.json**

Create `packages/docs/tsconfig.json`:

```json
{
  "extends": "astro/tsconfigs/strict"
}
```

- [ ] **Step 4: Create content collection config**

Create `packages/docs/src/content.config.ts`:

```typescript
import { defineCollection } from 'astro:content';
import { docsLoader } from '@astrojs/starlight/loaders';
import { docsSchema } from '@astrojs/starlight/schema';

export const collections = {
  docs: defineCollection({ loader: docsLoader(), schema: docsSchema() }),
};
```

- [ ] **Step 5: Create custom CSS**

Create `packages/docs/src/styles/custom.css`:

```css
:root {
  --sl-color-accent-low: #fff7ed;
  --sl-color-accent: #f97316;
  --sl-color-accent-high: #9a3412;
  --sl-color-white: #fafaf9;
  --sl-color-gray-1: #e7e5e4;
  --sl-color-gray-2: #d6d3d1;
  --sl-color-gray-3: #a8a29e;
  --sl-color-gray-4: #78716c;
  --sl-color-gray-5: #44403c;
  --sl-color-gray-6: #1c1917;
  --sl-color-black: #0c0a09;
  --sl-font: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  --sl-font-mono: 'SF Mono', SFMono-Regular, Consolas, 'Liberation Mono', Menlo, monospace;
}
```

- [ ] **Step 6: Install dependencies and verify build scaffolding**

Run:
```bash
cd packages/docs && bun install
```

Expected: Dependencies install without errors.

- [ ] **Step 7: Commit**

```bash
git add packages/docs/package.json packages/docs/astro.config.mjs packages/docs/tsconfig.json packages/docs/src/content.config.ts packages/docs/src/styles/custom.css
git commit -m "feat(docs): scaffold Astro Starlight docs package"
```

---

### Task 2: Update monorepo configs

**Files:**
- Modify: `package.json` (root)
- Modify: `biome.json`
- Modify: `knip.config.ts`
- Modify: `.gitignore`
- Modify: `.changeset/config.json`

- [ ] **Step 1: Add docs to root workspaces**

In `package.json` (root), add `"packages/docs"` to the `workspaces` array:

```json
"workspaces": [
  "packages/cli",
  "packages/core",
  "packages/mcp",
  "packages/skills",
  "packages/docs"
]
```

- [ ] **Step 2: Exclude Astro build artifacts from Biome**

In `biome.json`, add to `files.includes`:

```json
"includes": [
  "**/*.ts",
  "**/*.tsx",
  "**/*.js",
  "**/*.jsx",
  "!**/dist",
  "!**/node_modules",
  "!packages/docs/.astro",
  "!packages/docs/dist"
]
```

- [ ] **Step 3: Add docs to knip config**

In `knip.config.ts`, add the docs workspace:

```typescript
"packages/docs": {
  entry: ["src/content.config.ts", "astro.config.mjs"],
  project: ["src/**/*.{ts,astro,mdx}"],
  ignore: ["dist/**", ".astro/**"],
},
```

- [ ] **Step 4: Update .gitignore**

Add to `.gitignore`:

```
# Astro build artifacts
packages/docs/dist/
packages/docs/.astro/

# Superpowers brainstorm sessions
.superpowers/
```

- [ ] **Step 5: Add @maina/docs to changesets linked packages**

In `.changeset/config.json`, update linked array:

```json
"linked": [
  ["@maina/cli", "@maina/core", "@maina/mcp", "@maina/skills"]
]
```

Note: Do NOT add `@maina/docs` — it's `"private": true` and never published. Keep linked as-is.

- [ ] **Step 6: Run bun install from root to link workspace**

Run:
```bash
bun install
```

Expected: `packages/docs` appears in workspace resolution.

- [ ] **Step 7: Verify monorepo scripts still work**

Run:
```bash
bun run check && bun run typecheck
```

Expected: PASS — docs package should not break existing lint or typecheck.

- [ ] **Step 8: Commit**

```bash
git add package.json biome.json knip.config.ts .gitignore .changeset/config.json bun.lock
git commit -m "chore: add packages/docs to monorepo workspace configs"
```

---

### Task 3: Create golden spiral mynah SVG

**Files:**
- Create: `packages/docs/src/assets/mynah.svg`
- Create: `packages/docs/public/favicon.svg`

- [ ] **Step 1: Create the main logo SVG**

Create `packages/docs/src/assets/mynah.svg`:

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="120" height="150" viewBox="0 0 120 150">
  <!-- Body — golden spiral form -->
  <path d="M60,18 C85,12 100,30 98,55 C96,78 82,98 58,102 C34,106 20,90 20,68 C20,50 32,30 60,18Z" fill="#1a1a1a"/>
  <!-- Wing — inner spiral -->
  <path d="M58,30 C75,26 88,38 86,55 C84,70 74,82 58,85 C42,88 32,78 32,62 C32,48 42,34 58,30Z" fill="#333"/>
  <!-- Core — orange spiral heart -->
  <path d="M58,45 C68,42 76,50 74,58 C72,66 65,72 58,72 C50,72 44,66 44,58 C44,50 50,44 58,45Z" fill="#f97316"/>
  <!-- Beak -->
  <polygon points="98,42 115,35 108,46" fill="#f97316"/>
  <!-- Eye -->
  <circle cx="86" cy="38" r="3" fill="#fafaf9"/>
  <!-- Tail -->
  <path d="M20,78 C14,92 8,108 12,118 L22,112 C20,100 22,88 24,80Z" fill="#1a1a1a"/>
</svg>
```

- [ ] **Step 2: Create favicon**

Create `packages/docs/public/favicon.svg` — same content as mynah.svg but with a tighter viewBox for icon use:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 150">
  <path d="M60,18 C85,12 100,30 98,55 C96,78 82,98 58,102 C34,106 20,90 20,68 C20,50 32,30 60,18Z" fill="#1a1a1a"/>
  <path d="M58,30 C75,26 88,38 86,55 C84,70 74,82 58,85 C42,88 32,78 32,62 C32,48 42,34 58,30Z" fill="#333"/>
  <path d="M58,45 C68,42 76,50 74,58 C72,66 65,72 58,72 C50,72 44,66 44,58 C44,50 50,44 58,45Z" fill="#f97316"/>
  <polygon points="98,42 115,35 108,46" fill="#f97316"/>
  <circle cx="86" cy="38" r="3" fill="#fafaf9"/>
  <path d="M20,78 C14,92 8,108 12,118 L22,112 C20,100 22,88 24,80Z" fill="#1a1a1a"/>
</svg>
```

- [ ] **Step 3: Commit**

```bash
git add packages/docs/src/assets/mynah.svg packages/docs/public/favicon.svg
git commit -m "feat(docs): add golden spiral mynah bird logo SVG"
```

---

### Task 4: Build custom landing page

**Files:**
- Create: `packages/docs/src/pages/index.astro`
- Create: `packages/docs/src/components/Hero.astro`
- Create: `packages/docs/src/components/Engines.astro`
- Create: `packages/docs/src/components/Terminal.astro`
- Create: `packages/docs/src/components/Features.astro`
- Create: `packages/docs/src/components/Footer.astro`
- Create: `packages/docs/src/styles/landing.css`

- [ ] **Step 1: Create landing page CSS**

Create `packages/docs/src/styles/landing.css` with all design tokens and landing-specific styles:

```css
:root {
  --bg: #fafaf9;
  --bg-alt: #f5f5f4;
  --text: #1a1a1a;
  --text-secondary: #78716c;
  --text-muted: #a8a29e;
  --accent: #f97316;
  --card-bg: #ffffff;
  --card-border: #e7e5e4;
  --font: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  --font-mono: 'SF Mono', SFMono-Regular, Consolas, 'Liberation Mono', Menlo, monospace;
}

* { margin: 0; padding: 0; box-sizing: border-box; }

body {
  font-family: var(--font);
  background: var(--bg);
  color: var(--text);
  -webkit-font-smoothing: antialiased;
}

a { color: inherit; text-decoration: none; }

.container {
  max-width: 1080px;
  margin: 0 auto;
  padding: 0 24px;
}

/* Nav */
.nav {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 32px;
  border-bottom: 1px solid var(--card-border);
}

.nav-brand {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 18px;
  font-weight: 700;
  letter-spacing: -0.5px;
}

.nav-brand img { width: 28px; height: 35px; }

.nav-links {
  display: flex;
  gap: 24px;
  align-items: center;
  font-size: 14px;
  color: var(--text-secondary);
}

.nav-links a:hover { color: var(--text); }

.nav-cta {
  background: var(--text);
  color: white !important;
  padding: 6px 14px;
  border-radius: 6px;
  font-size: 13px;
}

/* Hero */
.hero {
  padding: 72px 24px 56px;
  text-align: center;
  max-width: 680px;
  margin: 0 auto;
}

.hero-logo { margin-bottom: 28px; filter: drop-shadow(0 4px 12px rgba(249,115,22,0.15)); }

.hero h1 {
  font-size: 44px;
  font-weight: 800;
  line-height: 1.12;
  letter-spacing: -1.5px;
  margin-bottom: 18px;
}

.hero-subtitle {
  font-size: 18px;
  color: var(--text-secondary);
  line-height: 1.6;
  margin-bottom: 32px;
}

.hero-actions {
  display: flex;
  gap: 12px;
  justify-content: center;
  margin-bottom: 40px;
  flex-wrap: wrap;
}

.btn-primary {
  background: var(--text);
  color: white;
  padding: 12px 28px;
  border-radius: 8px;
  font-size: 15px;
  font-family: var(--font-mono);
  display: inline-block;
}

.btn-secondary {
  border: 1.5px solid var(--card-border);
  color: var(--text);
  padding: 12px 28px;
  border-radius: 8px;
  font-size: 15px;
  display: inline-block;
}

.btn-secondary:hover { border-color: var(--text-secondary); }

.metrics {
  display: flex;
  gap: 40px;
  justify-content: center;
  flex-wrap: wrap;
}

.metric { text-align: center; }
.metric-value { font-size: 24px; font-weight: 700; color: var(--text); }
.metric-label { font-size: 13px; color: var(--text-muted); margin-top: 2px; }

/* Engines section */
.engines-section {
  background: var(--bg-alt);
  padding: 64px 24px;
  border-top: 1px solid var(--card-border);
}

.section-label {
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 3px;
  color: var(--accent);
  font-weight: 600;
  text-align: center;
}

.section-title {
  font-size: 28px;
  font-weight: 700;
  text-align: center;
  margin: 8px 0 32px;
}

.engine-cards {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 20px;
  max-width: 840px;
  margin: 0 auto;
}

.engine-card {
  background: var(--card-bg);
  border-radius: 10px;
  padding: 24px;
  border: 1px solid var(--card-border);
}

.engine-tag {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 2px;
  color: var(--accent);
  margin-bottom: 8px;
}

.engine-card h3 { font-weight: 600; margin-bottom: 8px; }

.engine-card p {
  font-size: 14px;
  color: var(--text-secondary);
  line-height: 1.55;
}

/* Terminal section */
.terminal-section {
  padding: 64px 24px;
}

.terminal {
  max-width: 640px;
  margin: 32px auto 0;
  background: #1a1a1a;
  border-radius: 10px;
  overflow: hidden;
  box-shadow: 0 8px 32px rgba(0,0,0,0.12);
}

.terminal-header {
  display: flex;
  gap: 6px;
  padding: 12px 16px;
  background: #2a2a2a;
}

.terminal-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
}

.terminal-dot.red { background: #ff5f57; }
.terminal-dot.yellow { background: #febc2e; }
.terminal-dot.green { background: #28c840; }

.terminal-body {
  padding: 20px;
  font-family: var(--font-mono);
  font-size: 13px;
  line-height: 1.7;
  color: #e4e4e7;
}

.terminal-body .prompt { color: #22c55e; }
.terminal-body .cmd { color: #fafaf9; }
.terminal-body .dim { color: #71717a; }
.terminal-body .pass { color: #22c55e; }
.terminal-body .accent { color: #f97316; }

/* Features grid */
.features-section {
  background: var(--bg-alt);
  padding: 64px 24px;
  border-top: 1px solid var(--card-border);
}

.feature-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 20px;
  max-width: 840px;
  margin: 32px auto 0;
}

.feature-card {
  background: var(--card-bg);
  border-radius: 10px;
  padding: 24px;
  border: 1px solid var(--card-border);
  transition: border-color 0.15s;
}

.feature-card:hover { border-color: var(--accent); }

.feature-icon { font-size: 24px; margin-bottom: 12px; }
.feature-card h3 { font-size: 15px; font-weight: 600; margin-bottom: 6px; }
.feature-card p { font-size: 13px; color: var(--text-secondary); line-height: 1.5; }

/* Footer */
.footer {
  padding: 40px 24px;
  text-align: center;
  border-top: 1px solid var(--card-border);
  color: var(--text-muted);
  font-size: 13px;
}

.footer-links {
  display: flex;
  gap: 24px;
  justify-content: center;
  margin-bottom: 12px;
}

.footer-links a:hover { color: var(--text); }

/* Responsive */
@media (max-width: 768px) {
  .hero h1 { font-size: 32px; }
  .engine-cards, .feature-grid { grid-template-columns: 1fr; }
  .metrics { gap: 24px; }
  .nav-links { gap: 12px; }
}
```

- [ ] **Step 2: Create Hero component**

Create `packages/docs/src/components/Hero.astro`:

```astro
---
const base = import.meta.env.BASE_URL;
---

<section class="hero">
  <img src={`${base}favicon.svg`} alt="Maina" width="100" height="125" class="hero-logo" />
  <h1>Prove AI code is correct before it merges.</h1>
  <p class="hero-subtitle">
    CLI + MCP server + skills package. Three engines that observe your codebase,
    learn your conventions, and verify every change.
  </p>
  <div class="hero-actions">
    <a href={`${base}docs/getting-started`} class="btn-primary">$ bunx maina init</a>
    <a href={`${base}docs/getting-started`} class="btn-secondary">Read the docs</a>
  </div>
  <div class="metrics">
    <div class="metric">
      <div class="metric-value">802</div>
      <div class="metric-label">tests passing</div>
    </div>
    <div class="metric">
      <div class="metric-value">8.8s</div>
      <div class="metric-label">avg verify</div>
    </div>
    <div class="metric">
      <div class="metric-value">742</div>
      <div class="metric-label">entities indexed</div>
    </div>
    <div class="metric">
      <div class="metric-value">20</div>
      <div class="metric-label">CLI commands</div>
    </div>
  </div>
</section>
```

- [ ] **Step 3: Create Engines component**

Create `packages/docs/src/components/Engines.astro`:

```astro
---
const base = import.meta.env.BASE_URL;
const engines = [
  {
    tag: 'Context',
    title: 'Observes',
    description: '4-layer retrieval with PageRank scoring. Dynamic token budget. Tree-sitter AST. Sees exactly what matters.',
    href: `${base}docs/engines/context`,
  },
  {
    tag: 'Prompt',
    title: 'Learns',
    description: 'Versioned prompts that evolve from feedback. A/B tested improvements. Your conventions, automated.',
    href: `${base}docs/engines/prompt`,
  },
  {
    tag: 'Verify',
    title: 'Verifies',
    description: 'Deterministic pipeline. Diff-only filtering. Slop detection. Two-stage AI review. Nothing ships unchecked.',
    href: `${base}docs/engines/verify`,
  },
];
---

<section class="engines-section">
  <div class="container">
    <div class="section-label">Three Engines</div>
    <h2 class="section-title">Observe. Learn. Verify.</h2>
    <div class="engine-cards">
      {engines.map((engine) => (
        <a href={engine.href} class="engine-card">
          <div class="engine-tag">{engine.tag}</div>
          <h3>{engine.title}</h3>
          <p>{engine.description}</p>
        </a>
      ))}
    </div>
  </div>
</section>
```

- [ ] **Step 4: Create Terminal component**

Create `packages/docs/src/components/Terminal.astro`:

```astro
<section class="terminal-section">
  <div class="container">
    <div class="section-label">How It Works</div>
    <h2 class="section-title">Zero config. Three commands.</h2>
    <div class="terminal">
      <div class="terminal-header">
        <div class="terminal-dot red"></div>
        <div class="terminal-dot yellow"></div>
        <div class="terminal-dot green"></div>
      </div>
      <div class="terminal-body">
        <div><span class="prompt">$</span> <span class="cmd">bunx maina init</span></div>
        <div class="dim">  ✓ Detected: TypeScript + Bun + Biome</div>
        <div class="dim">  ✓ Created .maina/constitution.md</div>
        <div class="dim">  ✓ Indexed 742 semantic entities</div>
        <br />
        <div><span class="prompt">$</span> <span class="cmd">maina commit</span></div>
        <div class="dim">  ◆ Syntax guard ........... <span class="pass">pass</span> <span class="dim">120ms</span></div>
        <div class="dim">  ◆ Biome (423 rules) ..... <span class="pass">pass</span> <span class="dim">340ms</span></div>
        <div class="dim">  ◆ Slop detector ......... <span class="pass">pass</span> <span class="dim">85ms</span></div>
        <div class="dim">  ◆ Semgrep (2k rules) .... <span class="pass">pass</span> <span class="dim">1.2s</span></div>
        <div class="dim">  ◆ Secretlint ............ <span class="pass">pass</span> <span class="dim">90ms</span></div>
        <div><br /><span class="accent">  ✓ All gates passed.</span> Committed: <span class="cmd">feat: add user auth</span></div>
      </div>
    </div>
  </div>
</section>
```

- [ ] **Step 5: Create Features component**

Create `packages/docs/src/components/Features.astro`:

```astro
---
const base = import.meta.env.BASE_URL;
const features = [
  {
    icon: '⚡',
    title: 'MCP Server',
    description: '8 tools for any MCP-compatible IDE. Add Maina to Cursor, Claude Code, or VS Code with one config entry.',
    href: `${base}docs/mcp`,
  },
  {
    icon: '🔌',
    title: 'Cross-Platform Skills',
    description: 'Works with Claude Code, Cursor, Codex, and Gemini CLI. Progressive disclosure — 100 tokens to scan, 5k when activated.',
    href: `${base}docs/skills`,
  },
  {
    icon: '🔍',
    title: 'Slop Detection',
    description: 'Catches AI-generated filler: "certainly", "straightforward", vague error handling, unnecessary abstractions.',
    href: `${base}docs/engines/verify`,
  },
  {
    icon: '📊',
    title: 'PageRank Context',
    description: 'Tree-sitter AST extracts cross-file references. PageRank scores relevance. AI sees what matters, not everything.',
    href: `${base}docs/engines/context`,
  },
  {
    icon: '🧬',
    title: 'Prompt Evolution',
    description: 'Prompts are versioned software. Feedback drives A/B-tested improvements. Accept rates tracked per version.',
    href: `${base}docs/engines/prompt`,
  },
  {
    icon: '🚀',
    title: 'Zero Config',
    description: 'Works with nothing beyond Git and Bun. No accounts. No Docker. No cloud. Add AI and tools when ready.',
    href: `${base}docs/getting-started`,
  },
];
---

<section class="features-section">
  <div class="container">
    <div class="section-label">Features</div>
    <h2 class="section-title">Everything you need to ship verified code.</h2>
    <div class="feature-grid">
      {features.map((feature) => (
        <a href={feature.href} class="feature-card">
          <div class="feature-icon">{feature.icon}</div>
          <h3>{feature.title}</h3>
          <p>{feature.description}</p>
        </a>
      ))}
    </div>
  </div>
</section>
```

- [ ] **Step 6: Create Footer component**

Create `packages/docs/src/components/Footer.astro`:

```astro
<footer class="footer">
  <div class="footer-links">
    <a href="https://github.com/beeeku/maina">GitHub</a>
    <a href="https://www.npmjs.com/package/@maina/cli">npm</a>
    <a href="https://github.com/beeeku/maina/blob/master/LICENSE">Apache 2.0</a>
  </div>
  <p>Built with Maina. Verified by Maina.</p>
</footer>
```

- [ ] **Step 7: Create the landing page**

Create `packages/docs/src/pages/index.astro`:

```astro
---
import Hero from '../components/Hero.astro';
import Engines from '../components/Engines.astro';
import Terminal from '../components/Terminal.astro';
import Features from '../components/Features.astro';
import Footer from '../components/Footer.astro';
import '../styles/landing.css';

const base = import.meta.env.BASE_URL;
---

<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Maina — The verification-first developer OS</title>
    <meta name="description" content="CLI + MCP server + skills package that proves AI-generated code is correct before it merges. Three engines: Context, Prompt, Verify." />
    <link rel="icon" href={`${base}favicon.svg`} type="image/svg+xml" />
  </head>
  <body>
    <nav class="nav">
      <a href={base} class="nav-brand">
        <img src={`${base}favicon.svg`} alt="" width="22" height="28" />
        Maina
      </a>
      <div class="nav-links">
        <a href={`${base}docs/getting-started`}>Docs</a>
        <a href={`${base}docs/commands`}>Commands</a>
        <a href={`${base}docs/mcp`}>MCP</a>
        <a href="https://github.com/beeeku/maina">GitHub</a>
        <a href={`${base}docs/getting-started`} class="nav-cta">Get Started</a>
      </div>
    </nav>
    <Hero />
    <Engines />
    <Terminal />
    <Features />
    <Footer />
  </body>
</html>
```

- [ ] **Step 8: Verify landing page builds**

Run:
```bash
cd packages/docs && bun run build
```

Expected: Build completes. Output in `packages/docs/dist/` includes `index.html`.

- [ ] **Step 9: Commit**

```bash
git add packages/docs/src/
git commit -m "feat(docs): add custom landing page with hero, engines, terminal, features"
```

---

### Task 5: Write docs content — Start Here

**Files:**
- Create: `packages/docs/src/content/docs/getting-started.mdx`
- Create: `packages/docs/src/content/docs/commands.mdx`

- [ ] **Step 1: Create Getting Started page**

Create `packages/docs/src/content/docs/getting-started.mdx`:

```mdx
---
title: Getting Started
description: Install Maina and verify your first commit in under 2 minutes.
---

## Install

```bash
bun add -g maina
```

Or try without installing:

```bash
bunx maina init
bunx maina commit
```

**Requirements:** [Bun](https://bun.sh) runtime and Git. That's it.

## Quick Start

### 1. Initialize

```bash
maina init
```

Maina detects your stack, creates `.maina/constitution.md` with your project rules, and indexes your codebase with tree-sitter.

### 2. Verify and commit

```bash
maina commit
```

Runs the full verification pipeline — syntax guard, parallel analysis, slop detection, diff-only filtering — then commits if everything passes.

### 3. Full verification

```bash
maina verify
```

Run the pipeline without committing. Useful for CI or pre-push checks.

## Zero-Friction Layers

Maina works in layers — start with nothing, add capabilities when ready:

| Layer | What | Requires |
|-------|------|----------|
| **0 — Git-native** | Core verification with deterministic tools | Git + Bun |
| **1 — Add AI** | AI-powered fixes, reviews, context generation | `MAINA_API_KEY` or Ollama |
| **2 — Add tools** | Semgrep, Trivy, Secretlint, SonarQube | Auto-detected, auto-skipped if missing |
| **3 — Add PM** | GitHub Issues sync to Huly, Linear, Plane | Any GitHub-syncing PM tool |

No accounts. No Docker. No cloud. Everything lives in your repo.

## Next Steps

- [Commands Reference](/maina/docs/commands) — all 20 commands
- [Configuration](/maina/docs/configuration) — model tiers, budget, custom config
- [MCP Server](/maina/docs/mcp) — add Maina to your IDE
```

- [ ] **Step 2: Create Commands Reference page**

Create `packages/docs/src/content/docs/commands.mdx`:

```mdx
---
title: Commands
description: Complete reference for all 20 Maina CLI commands.
---

## Define Phase

| Command | Description |
|---------|-------------|
| `maina init` | Bootstrap Maina in any repo — detects stack, creates constitution, indexes codebase |
| `maina ticket` | Create a GitHub Issue with automatic module tagging |
| `maina context` | Generate focused codebase context (all 4 layers, exploration mode) |
| `maina context add <file>` | Add a file to the semantic custom context layer |
| `maina context show` | Show context layers with token counts and budget |
| `maina explain` | Visualize codebase structure with Mermaid dependency diagrams |
| `maina design` | Create an Architecture Decision Record (WHAT and WHY only) |
| `maina review design` | Review an ADR against existing decisions and constitution |

## Build Phase

| Command | Description |
|---------|-------------|
| `maina plan` | Create feature branch with structured plan (HOW) |
| `maina spec` | Generate TDD test stubs from plan — scored on clarity, testability, completeness |
| `maina commit` | Run verification pipeline on staged changes, then commit |

## Verify Phase

| Command | Description |
|---------|-------------|
| `maina verify` | Run full verification pipeline (syntax → parallel analysis → diff filter → AI) |
| `maina review` | Comprehensive two-stage code review (spec compliance + code quality) |
| `maina analyze` | Check spec/plan/tasks consistency for a feature |
| `maina pr` | Create a pull request with two-stage AI review |

## Meta

| Command | Description |
|---------|-------------|
| `maina learn` | Analyze feedback patterns and propose prompt improvements |
| `maina prompt edit <task>` | Open a prompt template in `$EDITOR` |
| `maina prompt list` | Show all prompt tasks with version and accept rate info |
| `maina cache stats` | Show cache hit rate, entries, storage, and tokens saved |
| `maina stats` | Show commit verification metrics, trends, and spec quality scores |
| `maina doctor` | Check tool installation and engine health |

## Common Workflows

### First-time setup

```bash
maina init          # Detects stack, creates constitution
maina doctor        # Check what tools are available
```

### Daily development

```bash
maina plan          # Create feature branch + plan
maina spec          # Generate TDD test stubs
# ... write code ...
maina commit        # Verify + commit
maina pr            # Create reviewed PR
```

### Prompt tuning

```bash
maina prompt list           # See all prompts + versions
maina prompt edit review    # Customize review behavior
maina learn                 # Analyze feedback, propose improvements
```
```

- [ ] **Step 3: Commit**

```bash
git add packages/docs/src/content/docs/getting-started.mdx packages/docs/src/content/docs/commands.mdx
git commit -m "docs: add getting started and commands reference pages"
```

---

### Task 6: Write docs content — Reference

**Files:**
- Create: `packages/docs/src/content/docs/configuration.mdx`
- Create: `packages/docs/src/content/docs/mcp.mdx`
- Create: `packages/docs/src/content/docs/skills.mdx`

- [ ] **Step 1: Create Configuration page**

Create `packages/docs/src/content/docs/configuration.mdx`:

```mdx
---
title: Configuration
description: Configure model tiers, budget limits, and project conventions.
---

## Config File

Create `maina.config.ts` in your project root:

```typescript
export default defineConfig({
  models: {
    mechanical: 'google/gemini-2.5-flash',
    standard: 'anthropic/claude-sonnet-4',
    architectural: 'anthropic/claude-sonnet-4',
    local: 'ollama/qwen3-coder-8b',
  },
  provider: 'openrouter',
  budget: { daily: 5.00, perTask: 0.50, alertAt: 0.80 },
});
```

## Model Tiers

Every AI call uses a specific tier based on the task complexity:

| Tier | Used for | Example model |
|------|----------|---------------|
| **mechanical** | Tests, commit messages, slop detection, compression | gemini-2.5-flash |
| **standard** | Reviews, plans, design docs | claude-sonnet-4 |
| **architectural** | Design review, architecture, prompt evolution | claude-sonnet-4 |
| **local** | Offline use via Ollama | qwen3-coder-8b |

## Constitution

The constitution lives at `.maina/constitution.md` — non-negotiable project rules injected into every AI call. Generated by `maina init`, manually editable. Not subject to A/B testing.

```markdown
# Project Constitution

## Stack
- Runtime: Bun
- Language: TypeScript strict
- Test: bun:test (NOT Jest)
- Error handling: Result<T, E> pattern. Never throw.

## Verification
- All commits pass: biome check + tsc --noEmit + bun test
- No console.log in production code
```

## Custom Prompts

Drop markdown files in `.maina/prompts/` to control AI behavior per task:

- `review.md` — What to focus on during code reviews
- `tests.md` — How your team writes tests
- `commit.md` — Commit message style

Edit with: `maina prompt edit review`

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `MAINA_API_KEY` | OpenRouter API key for AI features |
| `MAINA_PROVIDER` | Override provider (default: `openrouter`) |
| `EDITOR` | Editor for `maina prompt edit` |
```

- [ ] **Step 2: Create MCP Server page**

Create `packages/docs/src/content/docs/mcp.mdx`:

```mdx
---
title: MCP Server
description: Add Maina to any MCP-compatible IDE with one config entry.
---

## Setup

Add to your IDE's MCP configuration:

```json
{
  "mcpServers": {
    "maina": {
      "command": "maina",
      "args": ["--mcp"]
    }
  }
}
```

Works with Claude Code, Cursor, VS Code, and any MCP-compatible host.

## Tools

| Tool | Description |
|------|-------------|
| `getContext` | Get focused codebase context for a specific command |
| `getConventions` | Get project constitution and team conventions |
| `verify` | Run verification pipeline on staged or specified files |
| `checkSlop` | Check code for AI-generated slop patterns |
| `reviewCode` | Run two-stage review (spec compliance + code quality) on a diff |
| `explainModule` | Get Mermaid dependency diagram for a directory |
| `suggestTests` | Generate TDD test stubs from a plan.md file |
| `analyzeFeature` | Check spec/plan/tasks consistency for a feature |

Each tool delegates to the appropriate engine. All results are cached — same query never hits AI twice.

## How It Works

The MCP server is a thin wrapper over Maina's three engines:

```
IDE (Claude Code / Cursor / VS Code)
  │
  ├── getContext ────────→ Context Engine
  ├── getConventions ───→ Prompt Engine
  ├── verify ───────────→ Verify Engine
  ├── checkSlop ────────→ Verify Engine
  ├── reviewCode ───────→ Verify Engine + Prompt Engine
  ├── explainModule ────→ Context Engine (semantic layer)
  ├── suggestTests ─────→ Prompt Engine + Context Engine
  └── analyzeFeature ───→ Context Engine (all layers)
```

## Context in Your IDE

With the MCP server running, your AI assistant has access to Maina's full context engine. Instead of manually pasting code, the assistant calls `getContext` and gets exactly the right context for the task — PageRank-scored, budget-aware, and cached.
```

- [ ] **Step 3: Create Skills page**

Create `packages/docs/src/content/docs/skills.mdx`:

```mdx
---
title: Skills
description: Cross-platform skills for Claude Code, Cursor, Codex, and Gemini CLI.
---

## What Are Skills?

Skills are instruction files that teach any AI agent your team's verification workflow. They work without the CLI installed — an agent with just the skills follows the same process.

Progressive disclosure: ~100 tokens to scan, under 5k when activated.

## Available Skills

| Skill | Purpose |
|-------|---------|
| `verification-workflow` | End-to-end verification process — the full maina commit flow as instructions |
| `context-generation` | Focused codebase context assembly — how to use the 4-layer retrieval |
| `plan-writing` | Structured feature planning — branch creation, plan.md format, task breakdown |
| `code-review` | Two-stage review methodology — spec compliance then code quality |
| `tdd` | Test-driven development workflow — 5 test categories, red-green-refactor |

## Installation

```bash
bun add -D @maina/skills
```

Skills are Markdown files (`SKILL.md`) distributed via npm. Each AI platform discovers them differently:

- **Claude Code** — Place in `.claude/skills/` or reference via MCP
- **Cursor** — Add to `.cursorrules` or project instructions
- **Codex** — Reference in `AGENTS.md`
- **Gemini CLI** — Add to `GEMINI.md`

## How Skills Work

Each skill follows a consistent pattern:

1. **Trigger** — When should this skill activate?
2. **Context** — What does the agent need to know?
3. **Steps** — What should the agent do, in order?
4. **Verification** — How does the agent confirm success?

Skills complement the CLI and MCP server. Use the CLI for direct terminal workflows, MCP for IDE integration, and skills for teaching any AI agent your process.
```

- [ ] **Step 4: Commit**

```bash
git add packages/docs/src/content/docs/configuration.mdx packages/docs/src/content/docs/mcp.mdx packages/docs/src/content/docs/skills.mdx
git commit -m "docs: add configuration, MCP server, and skills reference pages"
```

---

### Task 7: Write docs content — Engines

**Files:**
- Create: `packages/docs/src/content/docs/engines/context.mdx`
- Create: `packages/docs/src/content/docs/engines/prompt.mdx`
- Create: `packages/docs/src/content/docs/engines/verify.mdx`

- [ ] **Step 1: Create Context Engine page**

Create `packages/docs/src/content/docs/engines/context.mdx`:

```mdx
---
title: Context Engine
description: "4-layer retrieval with PageRank scoring and dynamic token budgets."
---

The brain. Knows your codebase, your team's history, and what matters right now.

## The Problem

Stuffing everything into the context window degrades AI output at ~60% utilization. A 2,000-line file read wastes 15,000 tokens when you need 10 lines.

## Four Layers

| Layer | What | Budget | Loaded when |
|-------|------|--------|-------------|
| **Working** | Current branch, PLAN.md, touched files, last verification | ~15% | Always |
| **Episodic** | Compressed PR summaries, review feedback. Ebbinghaus decay — fades if not reinforced. | ~15% | Most commands |
| **Semantic** | Module entities (tree-sitter AST), dependency graph (PageRank-scored), ADRs, constitution | ~20% | When AI needs codebase awareness |
| **Retrieval** | Code search, on-demand only | ~10% | Only when explicitly needed |

40% headroom reserved for AI reasoning and output. Never filled.

## Dynamic Budget

Each command declares its context needs via a selector:

| Mode | Budget | Used by |
|------|--------|---------|
| **Focused** | 40% | `maina commit` — fast, working layer only |
| **Default** | 60% | Most commands |
| **Explore** | 80% | `maina context` — full exploration |

## PageRank for Relevance

Tree-sitter extracts cross-file references and builds a directed dependency graph. PageRank runs with a personalization vector biased toward the current task:

- **×10** for identifiers in the current ticket
- **×50** for files already in context
- **×0.1** for private names

The result: AI sees the most relevant code first, ranked by actual dependency importance — not just proximity.

## Commands

```bash
maina context              # Generate full context (explore mode)
maina context add <file>   # Add file to semantic custom context
maina context show         # Show layers with token counts
```
```

- [ ] **Step 2: Create Prompt Engine page**

Create `packages/docs/src/content/docs/engines/prompt.mdx`:

```mdx
---
title: Prompt Engine
description: "Versioned prompts that evolve from feedback via A/B testing."
---

Prompts are versioned software, not static text.

## The Problem

The best prompt for a team changes as their codebase and conventions evolve. A prompt that works for a Django monolith is wrong for a microservices Go codebase. Teams can't tune prompts without understanding prompt engineering.

## Constitution

Non-negotiable project rules that survive everything. Generated by `maina init`, stored in `.maina/constitution.md`. Injected as preamble into every AI call.

```markdown
# Project Constitution

## Stack
- Runtime: Bun (NOT Node.js)
- Error handling: Result<T, E> pattern. Never throw.

## Verification
- All commits pass: biome check + tsc --noEmit + bun test
- No console.log in production code
```

The constitution is stable DNA — not subject to A/B testing.

## Custom Prompts

Drop markdown files in `.maina/prompts/` to control AI behavior per task:

- `review.md` — What to focus on during reviews
- `tests.md` — How your team writes tests
- `commit.md` — Commit message style and scope rules

Edit with `maina prompt edit review`. List with `maina prompt list`.

## Prompt Versioning

Every prompt (default + custom) is hashed. Usage and accept rates are tracked per version. When you accept or reject AI output, the outcome records against the prompt hash.

## Evolution Loop

```
Prompt v1 → AI output → Human accepts/rejects
                              ↓
                    Feedback stored with prompt hash
                              ↓
                    maina learn analyses patterns
                              ↓
                    AI proposes improved prompt v2
                              ↓
                    Developer reviews diff
                              ↓
                    A/B test: 80% v2, 20% v1
                              ↓
                    v2 outperforms → promoted
                    v2 underperforms → retired
```

Candidates auto-promoted at >5% improvement, retired at <-5%.

## Commands

```bash
maina prompt list           # All prompts + versions + accept rates
maina prompt edit <task>    # Open in $EDITOR
maina learn                 # Analyze feedback, propose improvements
```
```

- [ ] **Step 3: Create Verify Engine page**

Create `packages/docs/src/content/docs/engines/verify.mdx`:

```mdx
---
title: Verify Engine
description: "Deterministic pipeline with syntax guard, parallel analysis, and two-stage review."
---

Deterministic tools find issues. AI generates fixes. Humans review. Feedback improves everything.

## The Problem

AI-generated code ships with vulnerabilities, dead code, hallucinated imports, and copy-paste patterns that no linter catches. Manual code review can't keep pace with AI generation speed.

## Pipeline

```
Code change (diff)
    │
    ▼
Syntax Guard (Biome, <500ms) ─── REJECT if invalid
    │
    ▼
Parallel Deterministic Analysis
    │  Biome (423+ rules)
    │  Semgrep (2,000+ SAST rules)
    │  SonarQube CE (quality gates)
    │  Secretlint (secrets)
    │  Trivy (dependency CVEs)
    │  diff-cover (coverage)
    │  Stryker (mutation testing)
    │  Slop detector
    │
    ▼
Diff-only filter ─── Only findings on changed lines
    │
    ▼
AI Fix Layer ─── Context-aware, cache-checked
    │
    ▼
Two-stage Review
    │  Stage 1: Spec compliance (matches PLAN.md?)
    │  Stage 2: Code quality (clean, tested, safe?)
```

## Key Principles

**Syntax guard rejects first.** Invalid code never reaches expensive analysis tools. Biome check runs in under 500ms.

**Diff-only.** Only findings on changed lines are reported. No pre-existing noise from legacy code.

**Tools are auto-detected.** Missing tools are skipped, not errors. Works with zero external tools installed. Add Semgrep, Trivy, or Secretlint when ready.

**Single LLM call.** Every command makes at most one AI call. All intelligence goes into context selection. Exception: PR review gets two (spec compliance + code quality).

**Slop detection.** Catches AI-generated filler patterns: "certainly", "straightforward", vague error handling, unnecessary abstractions, placeholder comments.

## Tools

| Tool | What it checks | Required? |
|------|---------------|-----------|
| Biome | 423+ lint rules, formatting | Built-in |
| Slop detector | AI-generated filler patterns | Built-in |
| Semgrep | 2,000+ SAST security rules | Optional |
| Trivy | Dependency CVEs | Optional |
| Secretlint | Leaked secrets | Optional |
| SonarQube CE | Quality gates | Optional |
| diff-cover | Test coverage on changed code | Optional |
| Stryker | Mutation testing | Optional |

## Commands

```bash
maina verify          # Full pipeline
maina commit          # Pipeline + commit
maina review          # Two-stage AI review only
```
```

- [ ] **Step 4: Commit**

```bash
git add packages/docs/src/content/docs/engines/
git commit -m "docs: add context, prompt, and verify engine deep-dive pages"
```

---

### Task 8: Write docs content — Roadmap

**Files:**
- Create: `packages/docs/src/content/docs/roadmap.mdx`

- [ ] **Step 1: Create Roadmap page**

Create `packages/docs/src/content/docs/roadmap.mdx`:

```mdx
---
title: Roadmap
description: "What's next for Maina — browser verification, extension system, and more."
---

Maina is actively developed. Here's where we're headed.

## v1.1 — CLI Enhancements

- **`--json` output mode** for all commands — pipe Maina output into CI pipelines, dashboards, or other tools
- **Structured tool results** — separate AI-facing content from terminal-facing display, eliminating output parsing

## v1.5 — Browser Verification

- **`maina verify --dast`** — Dynamic Application Security Testing via ZAP REST API. Header analysis, cookie security, CSP validation, mixed content detection on running applications
- **`maina verify --lighthouse`** — Accessibility, performance, and SEO gates powered by Lighthouse audits
- **Playwright MCP integration** — Optional E2E verification using accessibility tree snapshots (structured data, not screenshots — dramatically more token-efficient)

## v2.0 — Extension System & Browser

- **Chrome MV3 extension** — WebSocket bridge connecting your browser to the Maina MCP server. DevTools panel shows verification results inline as you develop
- **`transformContext` hooks** — Extensions that inject or filter context before each AI call. Inspired by Pi's extension architecture
- **`maina extend` command** — Scaffold new hooks and extensions from templates

## Future

- **Cumulative file tracking** across context compaction sessions — never lose track of which files were touched
- **Branch summarization** — when a developer abandons a plan branch, auto-summarize and store as episodic context for future reference
- **Self-extending agent** — Maina builds its own extensions at runtime, iterating in a write-reload-test loop

## Contributing

Maina is open source under Apache 2.0. See the [GitHub repository](https://github.com/beeeku/maina) for issues, discussions, and contribution guidelines.
```

- [ ] **Step 2: Commit**

```bash
git add packages/docs/src/content/docs/roadmap.mdx
git commit -m "docs: add roadmap page with browser verification and extension system plans"
```

---

### Task 9: GitHub Actions — docs deploy

**Files:**
- Create: `.github/workflows/docs.yml`

- [ ] **Step 1: Create docs deploy workflow**

Create `.github/workflows/docs.yml`:

```yaml
name: Deploy Docs

on:
  push:
    branches: [master]
    paths:
      - 'packages/docs/**'
      - '.github/workflows/docs.yml'
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest

      - name: Install dependencies
        run: cd packages/docs && bun install

      - name: Build docs
        run: cd packages/docs && bun run build

      - name: Upload artifact
        uses: actions/upload-pages-artifact@v3
        with:
          path: packages/docs/dist

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v4
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/docs.yml
git commit -m "ci: add GitHub Actions workflow for docs deployment to GitHub Pages"
```

---

### Task 10: GitHub Actions — npm release

**Files:**
- Create: `.github/workflows/release.yml`

- [ ] **Step 1: Create npm release workflow**

Create `.github/workflows/release.yml`:

```yaml
name: Release

on:
  push:
    branches: [master]

concurrency:
  group: release
  cancel-in-progress: false

jobs:
  release:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest

      - name: Install dependencies
        run: bun install --frozen-lockfile

      - name: Build packages
        run: bun run build

      - name: Create release PR or publish
        uses: changesets/action@v1
        with:
          publish: bun run release
          version: bun run version
          title: 'chore: version packages'
          commit: 'chore: version packages'
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          NPM_TOKEN: ${{ secrets.NPM_TOKEN }}
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci: add GitHub Actions workflow for npm release via changesets"
```

---

### Task 11: Prepare npm publish

**Files:**
- Modify: `package.json` (root)
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Remove private flag from root package.json**

In `package.json` (root), remove the `"private": true` line. The individual packages control their own publishability.

- [ ] **Step 2: Fix CI workflow branch name**

The existing `.github/workflows/ci.yml` references `main` but the repo uses `master`. Update:

```yaml
on:
  push:
    branches: [master]
  pull_request:
    branches: [master]
```

- [ ] **Step 3: Verify package configs are correct**

Check that each publishable package has the required fields:

Run:
```bash
for pkg in cli core mcp skills; do echo "=== $pkg ===" && cat packages/$pkg/package.json | grep -E '"name"|"version"|"files"|"main"|"bin"'; done
```

Expected: Each package has `name`, `version`, `files`, and `main` (cli also has `bin`).

- [ ] **Step 4: Commit**

```bash
git add package.json .github/workflows/ci.yml
git commit -m "chore: prepare npm publish — remove private flag, fix CI branch"
```

---

### Task 12: Final build verification

- [ ] **Step 1: Full install from root**

Run:
```bash
bun install
```

Expected: All workspaces resolve, including `packages/docs`.

- [ ] **Step 2: Build docs site**

Run:
```bash
cd packages/docs && bun run build
```

Expected: Build succeeds, `dist/` contains `index.html` (landing page) and `docs/` directory with all pages.

- [ ] **Step 3: Preview locally**

Run:
```bash
cd packages/docs && bun run preview
```

Expected: Site serves at `localhost:4321/maina/`. Landing page loads at root. Docs pages load at `/maina/docs/*`. Sidebar navigation works. Search works.

- [ ] **Step 4: Run full monorepo verification**

Run:
```bash
bun run verify
```

Expected: Biome check, typecheck, and tests all pass. Docs package does not break existing packages.

- [ ] **Step 5: Verify all pages exist in build output**

Run:
```bash
ls packages/docs/dist/index.html packages/docs/dist/docs/getting-started/index.html packages/docs/dist/docs/commands/index.html packages/docs/dist/docs/configuration/index.html packages/docs/dist/docs/mcp/index.html packages/docs/dist/docs/skills/index.html packages/docs/dist/docs/engines/context/index.html packages/docs/dist/docs/engines/prompt/index.html packages/docs/dist/docs/engines/verify/index.html packages/docs/dist/docs/roadmap/index.html
```

Expected: All 10 files exist.

- [ ] **Step 6: Commit any fixes if needed, then final commit**

```bash
git add -A
git commit -m "chore(docs): final build verification and fixes"
```

Only commit if there are changes to commit. If build was clean, skip this step.
