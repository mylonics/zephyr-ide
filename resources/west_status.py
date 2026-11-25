# SPDX-License-Identifier: Apache-2.0
"""Read checkout and remote revisions without changing Git state."""
import os
from pathlib import Path
import re
import subprocess
from datetime import datetime, timezone


def checkout(project):
    folder = Path(project.abspath)
    if not (folder / ".git").exists():
        return {"state": "absent" if not folder.exists() else "invalid"}
    try:
        head = project.sha("HEAD")
    except (OSError, subprocess.CalledProcessError):
        return {"state": "invalid"}
    return {"state": "cloned", "head": head}


def remote_revision(project):
    when = datetime.now(timezone.utc).isoformat()
    revision = project.revision
    if revision == "HEAD" or revision.startswith("refs/"):
        refs = [revision]
    else:
        refs = ["refs/heads/" + revision, "refs/tags/" + revision]
    if refs[-1].startswith("refs/tags/"):
        refs.append(refs[-1] + "^{}")
    env = {
        **os.environ,
        "GIT_TERMINAL_PROMPT": "0",
        "GCM_INTERACTIVE": "never",
        "GIT_ALLOW_PROTOCOL": "https:http:ssh:git:file",
    }
    try:
        proc = subprocess.run(
            ["git", "ls-remote", "--exit-code", "--", project.url, *refs],
            cwd=project.topdir,
            env=env,
            stdin=subprocess.DEVNULL,
            capture_output=True,
            text=True,
            timeout=12,
            errors="replace",
        )
    except (OSError, subprocess.TimeoutExpired):
        return {"checkedAt": when, "error": "unavailable"}
    if proc.returncode:
        return {"checkedAt": when, "error": "refMissing" if proc.returncode == 2 else "unavailable"}
    entries = re.findall(r"(?m)^([0-9a-f]{40,64})\s+(\S+)$", proc.stdout)
    hashes = {ref: sha for sha, ref in entries}
    for ref in refs:
        if ref in hashes:
            return {"checkedAt": when, "sha": hashes.get(ref + "^{}", hashes[ref])}
    return {"checkedAt": when, "error": "refMissing"}
