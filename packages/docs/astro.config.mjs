import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import tailwindcss from '@tailwindcss/vite';
import starlightLlmsTxt from 'starlight-llms-txt';
import { REDIRECTS, SIDEBAR } from './src/navigation.ts';

export default defineConfig({
  site: 'https://mainahq.com',
  base: '/',
  vite: { plugins: [tailwindcss()] },
  // Sidebar and redirects live in src/navigation.ts, which the docs checks
  // (scripts/docs-links.ts, the install-docs test) read too.
  redirects: REDIRECTS,
  integrations: [
    starlight({
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
      sidebar: SIDEBAR,
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
