
import * as vscode from "vscode";


export const toolchainTargets: vscode.QuickPickItem[] = [
  { label: "arm-zephyr-eabi", picked: true },
  { label: "aarch64-zephyr-elf" },
  { label: "arc-zephyr-elf" },
  { label: "arc64-zephyr-elf" },
  { label: "microblazeel-zephyr-elf" },
  { label: "mips-zephyr-elf" },
  { label: "nios2-zephyr-elf" },
  { label: "riscv64-zephyr-elf" },
  { label: "sparc-zephyr-elf" },
  { label: "x86_64-zephyr-elf" },
  { label: "xtensa-amd_acp_6_0_adsp_zephyr-elf" },
  { label: "xtensa-dc233c_zephyr-elf" },
  { label: "xtensa-espressif_esp32s2_zephyr-elf" },
  { label: "xtensa-espressif_esp32s3_zephyr-elf" },
  { label: "xtensa-espressif_esp32_zephyr-elf" },
  { label: "xtensa-intel_ace15_mtpm_zephyr-elf" },
  { label: "xtensa-intel_ace30_ptl_zephyr-elf" },
  { label: "xtensa-intel_tgl_adsp_zephyr-elf" },
  { label: "xtensa-mtk_mt8195_adsp_zephyr-elf" },
  { label: "xtensa-nxp_imx8m_adsp_zephyr-elf" },
  { label: "xtensa-nxp_imx8ulp_adsp_zephyr-elf" },
  { label: "xtensa-nxp_imx_adsp_zephyr-elf" },
  { label: "xtensa-nxp_rt500_adsp_zephyr-elf" },
  { label: "xtensa-nxp_rt600_adsp_zephyr-elf" },
  { label: "xtensa-nxp_rt700_hifi1_zephyr-elf" },
  { label: "xtensa-nxp_rt700_hifi4_zephyr-elf" },
  { label: "xtensa-sample_controller32_zephyr-elf" },
  { label: "xtensa-sample_controller_zephyr-elf" }];

export const zephyrHals: vscode.QuickPickItem[] = [
  { label: "Altera", description: "hal_altera" },
  { label: "Ambiq", description: "hal_ambiq" },
  { label: "Atmel", description: "hal_atmel" },
  { label: "Espressif", description: "hal_espressif" },
  { label: "Ethos-U", description: "hal_ethos_u" },
  { label: "GigaDevice", description: "hal_gigadevice" },
  { label: "Infineon", description: "hal_infineon" },
  { label: "Intel", description: "hal_intel" },
  { label: "Microchip", description: "hal_microchip" },
  { label: "Nordic", description: "hal_nordic" },
  { label: "Nuvoton", description: "hal_nuvoton" },
  { label: "NXP", description: "hal_nxp" },
  { label: "OpenISA", description: "hal_openisa" },
  { label: "QuickLogic", description: "hal_quicklogic" },
  { label: "Renesas", description: "hal_renesas" },
  { label: "Raspberry Pi Pico", description: "hal_rpi_pico" },
  { label: "Silicon Labs", description: "hal_silabs" },
  { label: "STM32", description: "hal_stm32" },
  { label: "Telink", description: "hal_telink" },
  { label: "Ti", description: "hal_ti" },
  { label: "Würth Elektronik", description: "hal_wurthelektronik" },
  { label: "xtensa", description: "hal_xtensa" }
];

export const zephyrVersions = ["v4.2.0", "v4.1.0", "v4.0.0", "v3.7.0", "main", "Other Version"];
export const ncsVersions = ["v3.0.0", "v2.9.1", "v2.9.0", "main", "Other Version"];

export const sdkVersions = [
  { label: "0.17.3", description: "Zephyr 4.2" },
  { label: "0.17.0", description: "Zephyr 4.1-4.0" },
  { label: "0.16.9", description: "Zephyr 3.7" },
  { label: "sep", kind: vscode.QuickPickItemKind.Separator },
  { label: "latest", description: "Latest available version" },
  { label: "automatic", description: "Auto-detect from workspace" }
];
