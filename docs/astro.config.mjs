import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// Shared Mylonics styles — cloned into docs/mylonics-styles during CI.
// For local dev, clone manually:
//   git clone https://github.com/mylonics/mylonics-styles.git docs/mylonics-styles
import { mylonicsStarlightDefaults } from './mylonics-styles/starlight/config-helpers';

// https://astro.build/config
export default defineConfig({
  site: 'https://zephyr-ide.mylonics.com',
  integrations: [
    starlight({
      title: 'IDE for Zephyr',
      description:
        'Professional VS Code extension for Zephyr RTOS development. Streamline setup, building, flashing, and debugging of Zephyr projects.',
      logo: {
        src: './src/assets/logo.png',
      },
      favicon: '/favicon.ico',
      ...mylonicsStarlightDefaults('IDE for Zephyr', {
        github: 'https://github.com/mylonics/zephyr-ide',
        extraCss: ['./src/styles/custom.css'],
        headOptions: {
          ogImage:
            'https://raw.githubusercontent.com/mylonics/zephyr-ide/main/media/logo.png',
          keywords: [
            'VS Code extension',
            'west tool',
            'Zephyr SDK',
            'debugging',
          ],
        },
      }),
      sidebar: [
        {
          label: 'Getting Started',
          items: [
            { label: 'Installation', slug: 'getting-started/installation' },
            { label: 'Setup Panel', slug: 'getting-started/setup-panel' },
            { label: 'Host Tools', slug: 'getting-started/host-tools' },
            {
              label: 'Workspace Configuration',
              slug: 'getting-started/workspace-configuration',
            },
            {
              label: 'SDK Installation',
              slug: 'getting-started/sdk-installation',
            },
            {
              label: 'External Environments',
              slug: 'getting-started/external-environments',
            },
          ],
        },
        {
          label: 'User Guide',
          items: [
            { label: 'Project Setup', slug: 'user-guide/project-setup' },
            {
              label: 'Building & Debugging',
              slug: 'user-guide/building-debugging',
            },
            { label: 'Testing with Twister', slug: 'user-guide/testing' },
            { label: 'Sharing Code', slug: 'user-guide/sharing' },
            { label: 'Advanced Features', slug: 'user-guide/other-features' },
          ],
        },
        {
          label: 'Reference',
          items: [
            { label: 'Commands', slug: 'reference/commands' },
            { label: 'Configuration', slug: 'reference/configuration' },
            {
              label: 'Launch Helpers',
              slug: 'reference/launch-configuration',
            },
            { label: 'Extension Pack', slug: 'reference/extension-pack' },
            { label: 'Known Issues', slug: 'reference/known-issues' },
          ],
        },
        { label: 'Changelog', slug: 'changelog' },
        { label: 'Developer Guide', slug: 'developer-guide' },
      ],
    }),
  ],
});
