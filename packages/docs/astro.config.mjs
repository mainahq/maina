import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import tailwindcss from '@tailwindcss/vite';
import starlightLlmsTxt from 'starlight-llms-txt';

// Plausible domain is opt-in via env var. Unset (e.g. local dev, previews,
// or a build before Cloudflare Pages is wired) → no analytics tag is
// emitted. Pageviews + outbound-link clicks + tagged events ("install
// copy", "waitlist submit") are the only signals; no cookies, no PII.
// See docs/launch/utm-link-pack.md for the source-attribution playbook.
const PLAUSIBLE_DOMAIN = process.env.PUBLIC_PLAUSIBLE_DOMAIN || '';
const PLAUSIBLE_SRC =
  process.env.PUBLIC_PLAUSIBLE_SRC ||
  'https://plausible.io/js/script.tagged-events.outbound-links.js';

const analyticsHead = PLAUSIBLE_DOMAIN
  ? [
      {
        tag: 'script',
        attrs: {
          defer: true,
          'data-domain': PLAUSIBLE_DOMAIN,
          src: PLAUSIBLE_SRC,
        },
      },
      {
        tag: 'script',
        content:
          'window.plausible=window.plausible||function(){(window.plausible.q=window.plausible.q||[]).push(arguments)};',
      },
    ]
  : [];

// UTM capture — runs on every page load, stashes any utm_* + referrer +
// landing path in sessionStorage so WaitlistForm.astro can forward them
// with the submission (works for both the fetch path and the mailto
// fallback). Sized for inline injection; no external request.
const utmCaptureHead = [
  {
    tag: 'script',
    content: `
(function(){
  try {
    var KEY='maina_attrib';
    var params=new URLSearchParams(window.location.search);
    var fields=['utm_source','utm_medium','utm_campaign','utm_content','utm_term','ref','gclid'];
    var found={};
    var hasAny=false;
    fields.forEach(function(f){var v=params.get(f); if(v){found[f]=v.slice(0,128); hasAny=true;}});
    var prior={};
    try { prior=JSON.parse(sessionStorage.getItem(KEY)||'{}'); } catch(e) {}
    // First-touch attribution: only overwrite if we have new utm params,
    // otherwise keep the prior value so a deeper page-nav doesn't wipe it.
    if (hasAny) {
      found.referrer = document.referrer || prior.referrer || '';
      found.landing_path = window.location.pathname + window.location.search;
      found.landing_at = new Date().toISOString();
      sessionStorage.setItem(KEY, JSON.stringify(found));
    } else if (!prior.landing_path) {
      prior.referrer = document.referrer || '';
      prior.landing_path = window.location.pathname + window.location.search;
      prior.landing_at = new Date().toISOString();
      sessionStorage.setItem(KEY, JSON.stringify(prior));
    }
  } catch(e) {}
})();
`.trim(),
  },
];

export default defineConfig({
  site: 'https://mainahq.com',
  base: '/',
  vite: { plugins: [tailwindcss()] },
  redirects: {
    '/quickstart': '/getting-started',
    '/quickstart/': '/getting-started/',
  },
  integrations: [
    starlight({
      head: [...analyticsHead, ...utmCaptureHead],
      plugins: [
        starlightLlmsTxt({
          projectName: 'Maina',
          description:
            'Verification-first developer OS. CLI + MCP server + skills package that proves AI-generated code is correct before it merges.',
        }),
      ],
      title: 'Maina',
      logo: {
        src: './src/assets/mynah.svg',
        replacesTitle: false,
      },
      social: [
        {
          icon: 'github',
          label: 'GitHub',
          href: 'https://github.com/mainahq/maina',
        },
      ],
      editLink: {
        baseUrl: 'https://github.com/mainahq/maina/edit/master/packages/docs/',
      },
      sidebar: [
        {
          label: 'Start Here',
          items: [
            { slug: 'getting-started' },
            { slug: 'commands' },
          ],
        },
        {
          label: 'Reference',
          items: [
            { slug: 'configuration' },
            { slug: 'wiki' },
            { slug: 'cloud' },
            { slug: 'ci' },
            { slug: 'mcp' },
            { slug: 'skills' },
          ],
        },
        {
          label: 'Advanced',
          collapsed: true,
          items: [
            { slug: 'full-setup' },
          ],
        },
        {
          label: 'Engines',
          items: [
            { slug: 'engines/context' },
            { slug: 'engines/prompt' },
            { slug: 'engines/verify' },
          ],
        },
        {
          label: 'Cookbooks',
          items: [
            { slug: 'cookbooks/verify-pr-in-ci' },
            { slug: 'cookbooks/claude-code-self-check' },
            { slug: 'cookbooks/coderabbit-integration' },
            { slug: 'cookbooks/constitution-required-check' },
            { slug: 'cookbooks/playwright-mcp' },
          ],
        },
        {
          label: 'Blog',
          items: [
            { slug: 'blog/why-no-sdk' },
            { slug: 'blog/why-not-passmark' },
            { slug: 'blog/why-not-custom-search' },
            { slug: 'blog/wiki-is-a-view' },
          ],
        },
        {
          label: 'Roadmap',
          items: [
            { slug: 'roadmap' },
          ],
        },
      ],
      expressiveCode: {
        themes: ['github-dark', 'github-light'],
        useStarlightDarkModeSwitch: true,
        useStarlightUiThemeColors: true,
        styleOverrides: {
          borderRadius: '0.5rem',
        },
      },
      customCss: ['./src/styles/global.css'],
    }),
  ],
});
