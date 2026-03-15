import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// https://astro.build/config
export default defineConfig({
  site: 'https://zephyr-ide.mylonics.com',
  integrations: [
    starlight({
      title: 'Zephyr IDE',
      description:
        'Professional VS Code extension for Zephyr RTOS development. Streamline setup, building, flashing, and debugging of Zephyr projects.',
      logo: {
        src: './src/assets/logo.png',
      },
      favicon: '/favicon.ico',
      social: {
        github: 'https://github.com/mylonics/zephyr-ide',
      },
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
      head: [
        {
          tag: 'meta',
          attrs: {
            name: 'keywords',
            content:
              'Zephyr RTOS, VS Code extension, embedded development, Zephyr IDE, west tool, IoT development, firmware development, Zephyr SDK, debugging, embedded systems',
          },
        },
      ],
    }),
  ],
});
