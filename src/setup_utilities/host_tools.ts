/*
Copyright 2024 mylonics 
Author Rijesh Augustine

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/


import * as vscode from "vscode";
import * as path from "path";

import { output, executeTaskHelper, getPlatformArch, getPlatformName } from "../utilities/utils";
import { checkIfToolAvailable } from "./tools-validation";
import { WorkspaceConfig } from "./types";


export async function installWindowsHostTools(context: vscode.ExtensionContext, wsConfig?: WorkspaceConfig) {
  //Step 1
  // In order to install host tools in windows. Winget needs to be installed.

  //Lets check if winget is available
  if (wsConfig) {
    let wingetAvailable = await checkIfToolAvailable("winget", "winget --version", wsConfig, true);
    if (!wingetAvailable) {
      output.appendLine("[SETUP] Winget is not available. You can download winget from here: https://aka.ms/getwinget");
      return false;
    }
  }

  //Step 2
  // If winget is installed then we can install the required dependencies with this one liner;

  let result = await executeTaskHelper(
    "Install Host Tools",
    "winget install Kitware.CMake Ninja-build.Ninja oss-winget.gperf python Git.Git oss-winget.dtc wget 7zip.7zip; Start-Process powershell -Verb RunAs -ArgumentList '-NoExit', '-Command', '[System.Environment]::SetEnvironmentVariable(''Path'', ([System.Environment]::GetEnvironmentVariable(''Path'', ''Machine'') + '';C:\\Program Files\\7-Zip''), ''Machine'')'",
    ""
  );

  return result;
}

export async function installMacOSHostTools() {
  //Step 1 For mac OS there is a main install and download step that can be run without human intervention
  //Install Brew
  let cmd = '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"';
  let result = await executeTaskHelper("Install Host Tools", cmd, "");
  if (!result) {
    //Install failed in brew download
    return false;
  }

  // Add brew to path
  if (getPlatformArch() === "aarch64") {
    cmd = `(echo; echo 'eval "$(/opt/homebrew/bin/brew shellenv)"') >> ~/.zprofile && source ~/.zprofile`;
  } else {
    cmd = `(echo; echo 'eval "$(/usr/local/bin/brew shellenv)"') >> ~/.zprofile && source ~/.zprofile`;
  }
  result = await executeTaskHelper("Install Host Tools", cmd, "");
  if (!result) {
    //Install failed in brew install
    return false;
  }


  // Use brew to install dependencies
  cmd = "brew install cmake ninja gperf python3 python-tk ccache qemu dtc libmagic wget openocd";
  result = await executeTaskHelper("Install Host Tools", cmd, "");
  if (!result) {
    //Install failed in dependency download
    return false;
  }

  // add pythong to path
  cmd = `(echo; echo 'export PATH="'$(brew --prefix)'/opt/python/libexec/bin:$PATH"') >> ~/.zprofile && source ~/.zprofile`;
  result = await executeTaskHelper("Install Host Tools", cmd, "");
  if (!result) {
    //Install failed in adding python to path
  }

  //Step 2 Restart VSCode to ensure all new terminals
  return result;
}



export async function installLinuxHostTools() {
  //Step 1 Install dependencies with one liner

  let cmd = "sudo apt install --no-install-recommends git cmake ninja-build gperf \
  ccache dfu-util device-tree-compiler wget python3-dev python3-venv python3-tk \
  xz-utils file make gcc gcc-multilib g++-multilib libsdl2-dev libmagic1";
  let result = await executeTaskHelper("Install Host Tools", cmd, "");

  // That is it zephyr ide should be good to go.
  return result;
}

export async function installHostTools(context: vscode.ExtensionContext, wsConfig?: WorkspaceConfig) {
  switch (getPlatformName()) {
    case "macos":
      return await installMacOSHostTools();
    case "linux":
      return await installLinuxHostTools();
    case "windows":
      return await installWindowsHostTools(context, wsConfig);
  }
}