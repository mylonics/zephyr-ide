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
import * as os from "os";
import * as fs from "fs-extra";
import * as path from "path";

import { output, executeShellCommand, executeTaskHelper, getPlatformArch, getPlatformName } from "../utilities/utils";


export async function installWindowsHostTools() {
  return await executeTaskHelper("Install Host Tools", "winget install Kitware.CMake Ninja-build.Ninja oss-winget.gperf python Git.Git oss-winget.dtc wget 7zip.7zip; setx path '%path%;C:\\Program Files\\7-Zip'", "");
}

export async function installMacOSHostTools() {
  let cmd = '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"';

  await executeTaskHelper("Install Host Tools", cmd, "");

  if (getPlatformArch() === "aarch64") {
    cmd = `(echo; echo 'eval "$(/opt/homebrew/bin/brew shellenv)"') >> ~/.zprofile && source ~/.zprofile`;
  } else {
    cmd = `(echo; echo 'eval "$(/usr/local/bin/brew shellenv)"') >> ~/.zprofile && source ~/.zprofile`;
  }
  await executeTaskHelper("Install Host Tools", cmd, "");

  cmd = "brew install cmake ninja gperf python3 python-tk ccache qemu dtc libmagic wget openocd";
  await executeTaskHelper("Install Host Tools", cmd, "");

  cmd = `(echo; echo 'export PATH="'$(brew --prefix)'/opt/python/libexec/bin:$PATH"') >> ~/.zprofile && source ~/.zprofile`;
  return await executeTaskHelper("Install Host Tools", cmd, "");
}

export async function installLinuxHostTools() {
  let cmd = "sudo apt install --no-install-recommends git cmake ninja-build gperf \
  ccache dfu-util device-tree-compiler wget python3-dev python3-venv python3-tk \
  xz-utils file make gcc gcc-multilib g++-multilib libsdl2-dev libmagic1";
  return await executeTaskHelper("Install Host Tools", cmd, "");
}

export async function installHostTools() {
  switch (getPlatformName()) {
    case "macos":
      return await installMacOSHostTools();
    case "linux":
      return await installLinuxHostTools();
    case "windows":
      return await installWindowsHostTools();
  }
}