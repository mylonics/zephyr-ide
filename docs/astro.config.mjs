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
      ...mylonicsStarlightDefaults('IDE for Zephyr', { github: 'https://github.com/mylonics/zephyr-ide', extraCss: ['./src/styles/custom.css'], headOptions: { ogImage: 'https://raw.githubusercontent.com/mylonics/zephyr-ide/main/media/logo.png', keywords: ['Zephyr RTOS', 'VS Code extension', 'embedded development', 'Zephyr SDK', 'west tool', 'ARM Cortex-M', 'RISC-V', 'nRF Connect', 'STM32', 'ESP32', 'Raspberry Pi Pico', 'IoT development', 'firmware development', 'cross-compilation', 'devicetree', 'KConfig', 'debugging', 'flashing', 'CMake', 'embedded IDE'] } }),
      sidebar: [
        {
          label: 'Getting Started',
          items: [
            { label: 'Installation', slug: 'getting-started/installation' },
            { label: 'Setup Panel', slug: 'getting-started/setup-panel' },
            { label: 'Host Tools Installation', slug: 'getting-started/host-tools' },
            {
              label: 'Workspace Configuration',
              slug: 'getting-started/workspace-configuration',
            },
            {
              label: 'Zephyr SDK Installation',
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
            { label: 'Sharing Projects', slug: 'user-guide/sharing' },
            { label: 'Advanced Features', slug: 'user-guide/other-features' },
          ],
        },
        {
          label: 'Reference',
          items: [
            { label: 'Command Reference', slug: 'reference/commands' },
            { label: 'Configuration Settings', slug: 'reference/configuration' },
            {
              label: 'Launch Configuration Helpers',
              slug: 'reference/launch-configuration',
            },
            { label: 'Extension Pack', slug: 'reference/extension-pack' },
            { label: 'Known Issues', slug: 'reference/known-issues' },
          ],
        },
        { label: "What's New in 4.0", slug: 'whats-new-4-0' },
        { label: 'Changelog', slug: 'changelog' },
        { label: 'Developer Guide', slug: 'developer-guide' },
      ],
    }),
  ],
});
