import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

const config: Config = {
  title: 'Embershot Help',
  tagline: 'Documentation, FAQs, and guides for Embershot',
  favicon: 'img/favicon.ico',

  future: {
    v4: true,
  },

  url: 'https://docs.embershot.com',
  baseUrl: '/',

  // GitHub Pages deployment config - update organizationName when repo is created
  organizationName: 'ekhayes',
  projectName: 'embershot-docs',
  deploymentBranch: 'gh-pages',
  trailingSlash: false,

  onBrokenLinks: 'warn',
  markdown: {
    hooks: {
      onBrokenMarkdownLinks: 'warn',
      onBrokenMarkdownImages: 'warn',
    },
  },

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          routeBasePath: '/',
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
        sitemap: {
          changefreq: 'weekly',
          priority: 0.5,
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    image: 'img/embershot-social-card.png',
    colorMode: {
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: 'Help',
      logo: {
        alt: 'Embershot',
        src: 'img/logo.svg',
      },
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'helpSidebar',
          position: 'left',
          label: 'Documentation',
        },
        {
          href: 'https://embershot.com',
          label: 'embershot.com',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Documentation',
          items: [
            {
              label: 'Getting Started',
              to: '/getting-started',
            },
            {
              label: 'Sharing & Links',
              to: '/sharing-and-links',
            },
            {
              label: 'Security & MFA',
              to: '/security-and-mfa',
            },
          ],
        },
        {
          title: 'Embershot',
          items: [
            {
              label: 'Main site',
              href: 'https://embershot.com',
            },
            {
              label: 'Sign in',
              href: 'https://embershot.com/login',
            },
          ],
        },
        {
          title: 'Support',
          items: [
            {
              label: 'Contact us',
              href: 'mailto:support@embershot.com',
            },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} Embershot. All rights reserved.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
