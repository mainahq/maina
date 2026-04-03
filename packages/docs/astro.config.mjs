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
