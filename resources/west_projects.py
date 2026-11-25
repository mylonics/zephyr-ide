# SPDX-License-Identifier: Apache-2.0
"""Resolve the module picker using the workspace's installed west."""
import argparse
import configparser
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

import yaml
from west.configuration import Configuration, ConfigFile
from west.manifest import ImportFlag, Manifest, ManifestImportFailed

MARK = "zephyr-ide-additional"


def manifests():
    direct = Manifest.from_file(import_flags=ImportFlag.IGNORE_PROJECTS)
    try:
        return direct, Manifest.from_file(), False
    except ManifestImportFailed:
        # A new workspace may not have cloned its importing project yet.
        return direct, direct, True


def catalog():
    from west_status import checkout
    direct, resolved, partial = manifests()
    root_names = {p.name for p in direct.projects[1:]}
    return {"partial": partial, "projects": [
        {"name": p.name, "url": p.url, "revision": p.revision, "path": p.path,
         "checkout": checkout(p),
         "extra": isinstance(p.userdata, dict) and p.userdata.get(MARK) is True,
         "imported": p.name not in root_names}
        for p in resolved.projects[1:]
    ]}


def update(names, flags):
    if not names:
        raise ValueError("Select at least one project.")
    direct, resolved, _ = manifests()
    available = {p.name for p in resolved.projects[1:]}
    unknown = set(names) - available
    if unknown:
        raise ValueError("Unknown west projects: " + ", ".join(sorted(unknown)))
    cmd = [sys.executable, "-m", "west", "update", *flags, "--", *names]
    print(subprocess.list2cmdline(cmd[2:]), flush=True)
    direct_names = {p.name for p in direct.projects[1:]}
    if set(names) <= direct_names:
        return subprocess.call(cmd)
    # Named west updates accept only projects defined in the manifest repository.
    # Use the locally resolved definitions, including revisions, paths and submodules.
    # Override the local config for this child process only.
    root = Path(resolved.topdir)
    with tempfile.TemporaryDirectory(dir=root / ".west") as tmp:
        directory = Path(tmp)
        snapshot = directory / "west.yml"
        snapshot.write_text(resolved.as_yaml(), encoding="utf-8")
        config = configparser.ConfigParser(interpolation=None)
        source = os.environ.get("WEST_CONFIG_LOCAL") or root / ".west" / "config"
        with open(source, encoding="utf-8") as f:
            config.read_file(f)
        config["manifest"]["path"] = directory.relative_to(root).as_posix()
        config["manifest"]["file"] = snapshot.name
        local = directory / "config"
        with local.open("w", encoding="utf-8") as f:
            config.write(f)
        return subprocess.call(cmd, cwd=root, env={**os.environ, "WEST_CONFIG_LOCAL": str(local)})


def field(node, key):
    return next((v for k, v in node.value if k.value == key), None)


def edit_manifest(source, project, remove, allow_existing=False, additions=None):
    """Splice one sequence entry. Keep original comments, formatting and line endings."""
    eol = "\r\n" if "\r\n" in source else "\n"
    manifest = field(yaml.compose(source), "manifest")
    seq = field(manifest, "projects")
    name = project["name"]
    additions = additions if additions is not None else [project]
    records = [json.dumps(p, ensure_ascii=False) for p in additions]
    encoded = ", ".join(records)
    if seq is None:
        if remove:
            raise ValueError("Additional project no longer exists.")
        at = manifest.start_mark.index
        if manifest.flow_style:
            result = source[:at + 1] + '"projects": [' + encoded + '], ' + source[at + 1:]
        else:
            result = source[:at] + "projects: [" + encoded + "]" + eol + " " * manifest.start_mark.column + source[at:]
    elif seq.flow_style:
        # Only the flow sequence is re-encoded. Its entries may span several lines.
        items = yaml.safe_load(source)["manifest"]["projects"]
        if remove:
            items = remove_project(items, name, allow_existing)
        else:
            items.extend(additions)
        result = source[:seq.start_mark.index] + json.dumps(items, ensure_ascii=False) + source[seq.end_mark.index:]
    elif not remove:
        at = seq.start_mark.index
        indent = " " * seq.start_mark.column
        result = source[:at] + "".join("- " + item + eol + indent for item in records) + source[at:]
    else:
        items = yaml.safe_load(source)["manifest"]["projects"]
        kept = remove_project(items, name, allow_existing)
        index = next(i for i, item in enumerate(items) if item["name"] == name)
        dashes = [t.start_mark for t in yaml.scan(source)
                  if isinstance(t, yaml.tokens.BlockEntryToken)
                  and t.start_mark.column == seq.start_mark.column
                  and seq.start_mark.index <= t.start_mark.index < seq.end_mark.index]
        start = dashes[index].index
        last = max(t.end_mark.index for t in yaml.scan(source)
                   if start <= t.start_mark.index < seq.value[index].end_mark.index
                   and t.end_mark.index > t.start_mark.index)
        end = source.find("\n", last)
        if end < 0:
            end = len(source)
        else:
            end += 1
        result = source[:start - seq.start_mark.column] + (
            "" if kept else " " * seq.start_mark.column + "[]" + eol) + source[end:]
    # Refuse unusual YAML constructs if the splice would change anything else.
    expected = yaml.safe_load(source)
    items = expected["manifest"].setdefault("projects", [])
    expected["manifest"]["projects"] = remove_project(items, name, allow_existing) if remove else [*items, *additions]
    actual = yaml.safe_load(result)
    actual_items = actual["manifest"]["projects"]
    expected_items = expected["manifest"]["projects"]
    if not remove and actual_items[:len(additions)] == additions:
        expected_items[:] = additions + items
    if actual != expected:
        raise ValueError("Could not safely edit this manifest. Open it in the editor.")
    return result


def remove_project(items, name, allow_existing):
    for i, item in enumerate(items):
        if item["name"] == name and (allow_existing or (isinstance(item.get("userdata"), dict) and item["userdata"].get(MARK) is True)):
            return items[:i] + items[i + 1:]
    raise ValueError("Only additional projects in this manifest can be removed.")


def prepare_edit(data):
    source = data["source"]
    root = yaml.safe_load(source)["manifest"]
    previous = data.get("previous")
    original = next((p for p in root.get("projects", []) if p["name"] == previous), None)
    wrapper = False
    if original:
        source = edit_manifest(source, original, True, allow_existing=True)
    elif previous:
        # Import filters belong on an outer import so nested allowlists retain their semantics.
        resolved = Manifest.from_file()
        original = resolved.get_projects([previous])[0].as_dict()
        if not isinstance(root.get("self", {}).get("userdata"), dict) or not root["self"]["userdata"].get("zephyr-ide-overlay"):
            base = Path(resolved.abspath).relative_to(resolved.repo_abspath).as_posix()
            root = {"self": {"import": {"file": base, "name-blocklist": []},
                             "userdata": {"zephyr-ide-overlay": True}}}
            wrapper = True
        root["self"]["import"]["name-blocklist"].append(previous)
        source = yaml.safe_dump({"manifest": root}, sort_keys=False, allow_unicode=True)
    entries = data["entries"]
    if original and entries:
        original.pop("remote", None)
        original.pop("repo-path", None)
        entries = [{**original, **entries[0]}]
    if entries:
        source = edit_manifest(source, entries[0], False, additions=entries)
    return {"content": source, "wrapper": wrapper}


def activate_overlay(data):
    manifest = Manifest.from_file()
    original = Path(manifest.abspath)
    if original.resolve() != Path(data["file"]).resolve() or original.read_bytes().decode("utf-8-sig") != data["source"]:
        raise ValueError("The manifest changed. Refresh and try again.")
    with tempfile.NamedTemporaryFile(prefix="west-zephyr-ide-", suffix=".yml", dir=manifest.repo_abspath,
                                     delete=False, mode="w", encoding="utf-8", newline="") as f:
        overlay = Path(f.name)
        f.write(data["content"])
    try:
        # Validate with the workspace configuration, including manifest repositories initialized without Git.
        with tempfile.TemporaryDirectory() as directory:
            local = Path(directory) / "config"
            config = configparser.ConfigParser(interpolation=None)
            config.read(os.environ.get("WEST_CONFIG_LOCAL") or Path(manifest.topdir) / ".west" / "config", encoding="utf-8")
            config["manifest"]["file"] = overlay.name
            with local.open("w", encoding="utf-8") as stream:
                config.write(stream)
            check = subprocess.run([sys.executable, __file__, "list"], capture_output=True, text=True,
                                   env={**os.environ, "WEST_CONFIG_LOCAL": str(local)})
            if check.returncode:
                raise ValueError(check.stderr.strip())
        Configuration(topdir=Path(manifest.topdir)).set("manifest.file", overlay.name, ConfigFile.LOCAL)
    except Exception:
        overlay.unlink()
        raise


if __name__ == "__main__":
    sys.dont_write_bytecode = True
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=["list", "edit", "activate-overlay", "dependencies", "remote-revision", "update"])
    parser.add_argument("--narrow", action="store_true")
    parser.add_argument("--keep-descendants", action="store_true")
    parser.add_argument("names", nargs="*")
    args = parser.parse_intermixed_args()
    try:
        if args.action == "list":
            print(json.dumps(catalog()))
        elif args.action == "remote-revision":
            from west_status import remote_revision
            request = json.load(sys.stdin)
            project = next(p for p in manifests()[1].projects[1:] if p.name == request["name"])
            if project.url != request["url"] or project.revision != request["revision"]:
                raise ValueError("The manifest changed. Refresh and try again.")
            print(json.dumps(remote_revision(project)))
        elif args.action == "dependencies":
            from west_dependencies import discover
            inputs = json.load(sys.stdin)
            try:
                manifest = Manifest.from_file()
            except ManifestImportFailed as error:
                direct = Manifest.from_file(import_flags=ImportFlag.IGNORE_PROJECTS)
                provider = error.project
                if provider is None or provider.name not in {p.name for p in direct.projects[1:]} or provider.is_cloned():
                    raise
                print(json.dumps({"projects": [{"name": provider.name, "missing": True,
                      "requiredBy": ["west.yml"], "sources": [f"west.yml (import: {error.imp})"]}], "unknown": []}))
            else:
                print(json.dumps(discover(inputs, manifest)))
        elif args.action == "edit":
            data = json.load(sys.stdin)
            result = prepare_edit(data) if "entries" in data else edit_manifest(data["source"], data["project"], data["remove"])
            print(json.dumps(result))
        elif args.action == "activate-overlay":
            activate_overlay(json.load(sys.stdin))
            print("null")
        else:
            flags = [f for f, on in [("--narrow", args.narrow), ("--keep-descendants", args.keep_descendants)] if on]
            sys.exit(update(args.names, flags))
    except Exception as error:
        sys.exit(str(error))
