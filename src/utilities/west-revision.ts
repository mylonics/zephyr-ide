// SPDX-License-Identifier: Apache-2.0
import type { WestProject } from "../setup_utilities/west-projects";

export function isPinnedRevision(revision: string) {
  return /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(revision);
}

export function tracksRemoteRevision(project: WestProject) {
  return project.checkout.state === "cloned" && !isPinnedRevision(project.revision);
}
