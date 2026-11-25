# SPDX-License-Identifier: Apache-2.0
"""Identify named west projects from the selected application's build inputs."""
from pathlib import Path
import re
import subprocess


import yaml


def contents(path):
    return path.read_text(encoding="utf-8-sig", errors="replace") if path.is_file() else ""


def metadata(path):
    return yaml.safe_load(contents(path)) or {}


def names(value):
    items = [value] if isinstance(value, str) else value or []
    return [name for item in items for name in item.split()]


def token(name):
    return re.sub(r"[^A-Za-z0-9]", "_", name).upper()


def board_sources(name, board_dir, zephyr, app, module_roots):
    """Resolve the selected board and SoC, including out-of-tree board roots."""
    if not name:
        return
    board, _, qualifiers = name.partition("/")
    board = board.split("@")[0]
    roots = [app, *module_roots, zephyr]
    if board_dir:
        for parent in [board_dir, *board_dir.parents]:
            if parent.name == "boards":
                roots.insert(0, parent.parent)
                break
    roots = list(dict.fromkeys(roots))
    candidates = [board_dir / "board.yml"] if board_dir else []
    if not any(file.is_file() for file in candidates):
        candidates.extend(path for root in roots for path in (root / "boards").glob("*/*/board.yml")
                          if path.parent.name == board)
    for file in candidates:
        data = metadata(file)
        for entry in data.get("boards", []) or [data.get("board", {})]:
            if entry.get("name") != board:
                continue
            yield file.parent, None
            socs = [soc["name"] for soc in entry.get("socs", []) if "name" in soc]
            selected = qualifiers.split("/")[0]
            if selected not in socs:
                if len(socs) != 1:
                    return
                selected = socs[0]
            for root in roots:
                for soc_file in (root / "soc").glob("*/*/soc.yml"):
                    raw = contents(soc_file)
                    if selected not in raw:
                        continue
                    catalog = yaml.safe_load(raw) or {}
                    for family in catalog.get("family", []):
                        for series in family.get("series", []) or [{}]:
                            if any(x.get("name") == selected for x in series.get("socs", family.get("socs", []))):
                                yield soc_file.parent, (selected, family["name"])
                                if series.get("name") and (soc_file.parent / series["name"]).is_dir():
                                    yield soc_file.parent / series["name"], (selected, family["name"])
                                return
                    if any(x.get("name") == selected for x in catalog.get("socs", [])):
                        yield soc_file.parent, (selected, soc_file.parent.parent.name)
                        return
            return


# Consume strings, escapes and brackets before interpreting comment or command delimiters.
CMAKE_TOKENS = re.compile(
    r'\#?\[(?P<equals>=*)\[.*?\](?P=equals)\]|\#[^\n]*|"(?:\\.|[^"\\])*"|'
    r'\\.|\w+|\s+|.', re.S)


def cmake_commands(file):
    command, args, depth = "", [], 0
    for match in CMAKE_TOKENS.finditer(contents(file)):
        part = match[0]
        if part.startswith("#"):
            part = " "
        elif match["equals"] is not None:
            part = '""'  # Bracket arguments do not expand variables.
        if part == "(":
            depth += 1
            if depth == 1:
                args = []
                continue
        elif part == ")" and depth:
            depth -= 1
            if depth == 0:
                yield command, "".join(args).strip()
                command = ""
                continue
        if depth:
            args.append(part)
        elif not part.isspace():
            command = part.lower()


def cmake_refs(file, enabled):
    active = [True]
    for cmd, args in cmake_commands(file):
        if cmd in ("if", "function", "macro", "foreach", "while"):
            active.append(cmd == "if" and args in enabled)
        elif cmd in ("endif", "endfunction", "endmacro", "endforeach", "endwhile"):
            if len(active) > 1:
                active.pop()
        elif cmd in ("else", "elseif"):
            active[-1] = False
        elif all(active):
            if cmd.endswith(("_ifdef", "_ifndef")):
                first = args.split(maxsplit=1)
                if cmd.endswith("_ifndef") or not first or first[0] not in enabled:
                    continue
            # Escaped characters are literals. An escaped newline joins quoted text.
            expandable = re.sub(r"\\\n", "", args)
            expandable = re.sub(r"\\.", " ", expandable)
            yield from re.findall(r"\$\{ZEPHYR_([A-Z0-9_]+)_MODULE_DIR\}", expandable)


def kconfig_entries(file):
    """Yield declared symbols and their unconditional selects, excluding help text."""
    symbol = None
    help_indent = None
    for raw in contents(file).replace("\\\n", "").expandtabs().splitlines():
        line = raw.strip()
        if not line:
            continue
        indent = len(raw) - len(raw.lstrip())
        if help_indent == -1:
            help_indent = indent or None
        if help_indent is not None and indent >= help_indent:
            continue
        help_indent = None
        fields = line.partition("#")[0].split()
        if not fields:
            continue
        if fields[0] in ("config", "menuconfig") and len(fields) == 2:
            symbol = fields[1]
            yield symbol, None
        elif fields[0] in ("help", "---help---"):
            help_indent = -1
        elif fields[0] == "select" and len(fields) == 2 and symbol:
            yield symbol, fields[1]
        elif fields[0] in ("if", "endif", "menu", "endmenu", "choice", "endchoice",
                           "comment", "source", "rsource", "osource", "orsource"):
            symbol = None


def declared_scenarios(data, board):
    common = data.get("common") or {}
    scenarios = []
    for case in (data.get("tests") or {"": {}}).values():
        merged = {**common, **(case or {})}
        allow, exclude = names(merged.get("platform_allow")), names(merged.get("platform_exclude"))
        if board and ((allow and board not in allow) or board in exclude):
            continue
        scenarios.append(set(names(common.get("modules"))) | set(names(merged.get("modules"))))
    return set.intersection(*scenarios) if scenarios else set()


def can_align_checkout(project):
    if not re.fullmatch(r"(?:[a-fA-F0-9]{40}|[a-fA-F0-9]{64})", project.revision):
        return False
    head = project.sha("HEAD")
    if head == project.revision.lower():
        return False

    def git(*args):
        return subprocess.run(["git", *args], cwd=project.abspath, capture_output=True, text=True)

    # A clean detached checkout at west's last revision can advance without losing local work.
    previous = git("rev-parse", "--verify", "refs/heads/manifest-rev")
    if previous.returncode or previous.stdout.strip() != head or git("symbolic-ref", "-q", "HEAD").returncode != 1:
        return False
    status = git("status", "--porcelain")
    return status.returncode == 0 and not status.stdout


def index_modules(projects, zephyr):
    indexed = {token(name): name for name in projects}
    providers = {}
    module_roots = []
    for project in projects.values():
        root = Path(project.abspath)
        try:
            descriptor = metadata(root / "zephyr/module.yml")
        except (OSError, yaml.YAMLError):
            continue
        declared = descriptor.get("name")
        build = descriptor.get("build") or {}
        settings = build.get("settings") or {}
        for field in ("board_root", "soc_root"):
            if settings.get(field):
                module_roots.append(root / settings[field])
        integration = zephyr / "modules" / (declared or project.name) / "Kconfig"
        kconfig = root / build.get("kconfig", "zephyr/Kconfig")
        for file in (integration, kconfig):
            for option, selected in kconfig_entries(file):
                if selected is None:
                    providers.setdefault(option, set()).add(project.name)
        if declared:
            indexed.setdefault(token(declared), project.name)
    return indexed, providers, module_roots


def collect_cmake_modules(data, projects, indexed, module_roots, supplied_locally, require):
    local_modules = []
    for arg in data.get("cmakeArgs", []):
        definition = re.fullmatch(r"-D(BOARD_ROOT|SOC_ROOT|ZEPHYR_MODULES|EXTRA_ZEPHYR_MODULES|ZEPHYR_EXTRA_MODULES)(?::\w+)?=(.+)", arg)
        if not definition:
            continue
        for value in definition[2].split(";"):
            root = Path(value)
            if not root.is_absolute():
                continue
            if definition[1] in ("BOARD_ROOT", "SOC_ROOT"):
                module_roots.append(root)
                continue
            root = root.resolve()
            module = metadata(root / "zephyr/module.yml")
            if not module and not (root / "zephyr/CMakeLists.txt").is_file():
                # West knows the checkout path even before a module has been cloned.
                for project in projects.values():
                    if root == Path(project.abspath).resolve():
                        require(project.name, "-D" + definition[1])
                continue
            local_modules.append(root)
            declared_name = module.get("name") or root.name
            west_name = indexed.get(token(declared_name))
            if west_name and root == Path(projects[west_name].abspath).resolve():
                require(west_name, "-D" + definition[1])
            else:
                # This explicit module path already provides its Zephyr module locally.
                supplied_locally.add(token(declared_name))
            settings = (module.get("build") or {}).get("settings") or {}
            module_roots.extend(root / settings[k] for k in ("board_root", "soc_root") if k in settings)
    return local_modules


def collect_build_requirements(data, app, application, board, zephyr, module_roots, providers, require):
    for filename in ("sample.yaml", "testcase.yaml", "tests.yaml"):
        file = app / filename
        for name in declared_scenarios(metadata(file), board):
            require(name, file)
    sources = [(app, None), *board_sources(board, Path(data["boardDir"]) if data.get("boardDir") else None, zephyr, app, module_roots)]
    board_name = board.split("/")[0].split("@")[0]
    defconfigs = [directory / (board_name + "_defconfig") for directory, soc in sources[1:] if not soc]
    configs = {}
    for file in [*defconfigs, *map(Path, data.get("configs", [str(app / "prj.conf")]))]:
        for key, value in re.findall(r"^[ \t]*(CONFIG_\w+)[ \t]*=[ \t]*([yn])[ \t]*(?:\#[^\n]*)?$", contents(file), re.M):
            configs[key] = (value, file)
    enabled = {key for key, (value, _) in configs.items() if value == "y"}
    for key in enabled:
        name = key.removeprefix("CONFIG_")
        if len(providers.get(name, ())) == 1:
            require(next(iter(providers[name])), configs[key][1], detail=f" ({key}=y)")
        elif name.startswith("ZEPHYR_") and name.endswith("_MODULE"):
            require(name[7:-7].lower(), configs[key][1])
    for directory, soc in sources:
        owner = soc[0] if soc else (application if directory == app else board)
        file = directory / "CMakeLists.txt"
        for name in cmake_refs(file, enabled):
            require(name.lower(), file, owner)
        if soc:
            chip = soc[0]
            # Map unconditional selects of the selected SoC to a unique Zephyr integration.
            symbol = "SOC_" + token(chip)
            for kconfig in directory.glob("Kconfig*"):
                for declared, option in kconfig_entries(kconfig):
                    if declared == symbol and len(providers.get(option, ())) == 1:
                        require(next(iter(providers[option])), kconfig, owner, f" ({symbol}: select {option})")


def collect_module_dependencies(app, application, local_modules, projects, reasons, require):
    def module_deps(root, owner):
        file = root / "zephyr/module.yml"
        for dep in names((metadata(file).get("build") or {}).get("depends")):
            require(dep, file, owner)

    module_deps(app, application)
    for root in local_modules:
        module_deps(root, metadata(root / "zephyr/module.yml").get("name") or root.name)
    for project in projects.values():
        if Path(project.abspath) in app.parents:
            require(project.name, app)
    visited = set()
    while reasons.keys() - visited:
        for name in sorted(reasons.keys() - visited):
            visited.add(name)
            module_deps(Path(projects[name].abspath), name)


def dependency_report(projects, reasons, unknown, parents):
    detected = []
    for name, files in sorted(reasons.items()):
        project = projects[name]
        missing = not project.is_cloned()
        needs_update = not missing and can_align_checkout(project)
        detected.append({"name": name, "revision": project.revision, "missing": missing, "needsUpdate": needs_update,
                         "sources": sorted(files), "requiredBy": sorted(parents[name])})
    return {"projects": detected, "unknown": sorted(unknown), "unresolved": [
        {"name": name, "requiredBy": sorted(parents[name]), "sources": sorted(files)}
        for name, files in sorted(unknown.items())]}


def discover(data, manifest):
    app = Path(data["application"])
    projects = {p.name: p for p in manifest.projects[1:]}
    zephyr = Path(data["zephyr"]) if data.get("zephyr") else Path(
        projects["zephyr"].abspath if "zephyr" in projects else manifest.repo_abspath)
    board = data.get("board", "")
    indexed, providers, module_roots = index_modules(projects, zephyr)
    reasons = {}
    unknown = {}
    parents = {}
    supplied_locally = set()
    application = data.get("projectName") or app.name

    # Keep dependency evidence readable when a workspace is moved or shared.
    roots = [(app, "app"), (zephyr, "zephyr"), (Path(manifest.topdir), "west")]
    roots.extend((Path(project.abspath), project.name) for project in projects.values())
    roots.sort(key=lambda entry: len(entry[0].parts), reverse=True)

    def source_label(file):
        for root, label in roots:
            if file.is_relative_to(root):
                return (Path(label) / file.relative_to(root)).as_posix()
        return file.name

    def require(name, file, owner=application, detail=""):
        if token(name) in supplied_locally:
            return
        resolved = indexed.get(token(name))
        target = reasons if resolved else unknown
        source = source_label(file) if isinstance(file, Path) else file
        target.setdefault(resolved or name, set()).add(source + detail)
        parents.setdefault(resolved or name, set()).add(owner)

    local_modules = collect_cmake_modules(data, projects, indexed, module_roots, supplied_locally, require)
    collect_build_requirements(data, app, application, board, zephyr, module_roots, providers, require)
    collect_module_dependencies(app, application, local_modules, projects, reasons, require)
    return dependency_report(projects, reasons, unknown, parents)
