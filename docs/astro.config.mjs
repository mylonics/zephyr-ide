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
        'VS Code extension for Zephyr RTOS firmware development. Automates host tools, SDK install, west workspace setup, and Cortex-Debug integration for nRF52, STM32, ESP32, Raspberry Pi Pico, and any Zephyr-supported board.',,
      logo: {
        src: './src/assets/logo.png',
      },
      favicon: '/favicon.ico',
      ...mylonicsStarlightDefaults('IDE for Zephyr', { github: 'https://github.com/mylonics/zephyr-ide', extraCss: ['./src/styles/custom.css'], headOptions: { ogImage: 'https://raw.githubusercontent.com/mylonics/zephyr-ide/main/media/logo.png', keywords: ['Zephyr RTOS', 'VS Code extension', 'embedded development', 'Zephyr SDK', 'west tool', 'ARM Cortex-M', 'RISC-V', 'nRF Connect SDK', 'nRF52', 'nRF5340', 'Nordic Semiconductor', 'STM32', 'ESP32', 'Raspberry Pi Pico', 'RP2040', 'IoT development', 'firmware development', 'cross-compilation', 'devicetree', 'KConfig', 'debugging', 'flashing', 'CMake', 'embedded IDE', 'microcontroller', 'MCU', 'Bluetooth', 'BLE firmware', 'QEMU', 'native_sim', 'Twister', 'OpenOCD', 'J-Link', 'Cortex-Debug', 'west workspace', 'build system'] } }),
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
            { label: 'Build Dashboard & Advanced Tools', slug: 'user-guide/other-features' },
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
