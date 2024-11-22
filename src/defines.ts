
import * as vscode from "vscode";

export const toolchainTargets: vscode.QuickPickItem[] = [
  { picked: true, label: "arm" },
  { label: "sep", kind: vscode.QuickPickItemKind.Separator },
  { label: "aarch64" },
  { label: "arc" },
  { label: "arc64" },
  { label: "microblazeel" },
  { label: "mips" },
  { label: "nios2" },
  { label: "riscv64" },
  { label: "sparc" },
  { label: "x86_64" },
  { label: "xtensa-dc233c" },
  { label: "xtensa-espressif_esp32" },
  { label: "xtensa-espressif_esp32s2" },
  { label: "xtensa-espressif_esp32s3" },
  { label: "xtensa-intel_ace15_mtpm" },
  { label: "xtensa-intel_tgl_adsp" },
  { label: "xtensa-mtk_mt8195_adsp" },
  { label: "xtensa-nxp_imx8m_adsp" },
  { label: "xtensa-nxp_imx8ulp_adsp" },
  { label: "xtensa-nxp_imx_adsp" },
  { label: "xtensa-nxp_rt500_adsp" },
  { label: "xtensa-nxp_rt600_adsp" },
  { label: "xtensa-sample_controller" }];

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

export const zephyrVersions = ["v4.0.0", "v3.7.0", "main", "Other Version"];
export const ncsVersions = ["v2.8.0", "v2.7.0", "v2.6.2", "main", "Other Version"];
