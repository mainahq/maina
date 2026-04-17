import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  site: 'https://mainahq.com',
  base: '/',
  vite: { plugins: [tailwindcss()] },
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
            { slug: 'quickstart' },
            { slug: 'commands' },
            { slug: 'full-setup' },
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
          label: 'Engines',
          items: [
            { slug: 'engines/context' },
            { slug: 'engines/prompt' },
            { slug: 'engines/verify' },
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
