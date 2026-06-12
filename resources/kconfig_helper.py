#!/usr/bin/env python3
# Copyright 2026 mylonics
# Author Rijesh Augustine
# SPDX-License-Identifier: Apache-2.0
"""
kconfig_helper.py - long-running JSON-RPC bridge over kconfiglib.

This script is spawned by the Zephyr IDE extension (one process per open
DashboardPanel) and communicates over stdin/stdout using a line-delimited
JSON-RPC protocol.  It is intentionally a thin wrapper around `kconfiglib`
(already a Zephyr Python requirement) - all heavy lifting lives in that
library.  The IDE side is responsible for resolving the correct Kconfig root
file and the environment variables Zephyr's Kconfig tree expects (BOARD,
ARCH, ZEPHYR_BASE, ...) by parsing CMakeCache.txt and passing them in via
the `init` request.

Protocol
--------
Requests are single-line JSON objects:
    {"id": <int>, "method": "<name>", "params": { ... }}

Responses are single-line JSON objects:
    {"id": <int>, "result": { ... }}              # success
    {"id": <int>, "error": {"message": "..."}}    # failure

The helper may also emit unsolicited notifications (no "id"):
    {"event": "log", "level": "info", "message": "..."}

All requests are processed serially.  The helper exits cleanly on EOF or
when receiving the `shutdown` method.

Methods
-------
- init(params={kconfig_root, env, dot_config?, srctree?}) -> {symbols, top_menu}
    Loads the Kconfig tree.  Returns counts and the top-level menu structure.
- tree() -> {nodes: [...]}
    Returns the full menu tree as nested nodes.  Each node carries
    {name, prompt, type, value, visible, is_menu, is_choice, children: [...]}.
- symbol(name) -> { metadata }
    Returns full metadata for one symbol: type, prompt, help, defaults, ranges,
    direct_dependencies, defining_files, current_value, assignable_values.
- set(name, value) -> {changed: [{name, old, new}], invalidated: [names]}
    Sets a symbol's user value and reports any other symbols whose value or
    visibility changed as a side effect.
- diff() -> {changes: [{name, old, new}]}
    Reports every symbol whose value differs from the originally loaded
    .config (or default if no .config was loaded).
- save(path, minimal=true) -> {path}
    Writes a Kconfig fragment to disk (minimal config by default).
- reload() -> same shape as init
    Re-parses the Kconfig tree from scratch (e.g. after an external .config
    change).  Uses the env passed to the most recent init call.
- shutdown() -> {ok: true}
    Closes the helper.

The helper deliberately does NOT mutate any file on disk except via the
explicit `save` method.  All `set` operations live in memory until saved.
"""

import json
import os
import re
import subprocess
import sys
import traceback
from typing import Any, Dict, List, Optional, Set


def _try_import_kconfiglib():
    """Attempts to import kconfiglib, auto-pip-installing it on first miss.

    The Zephyr venv ships kconfiglib via the standard zephyr requirements, but
    workspaces created by Zephyr IDE before the in-dashboard editor existed
    may have skipped that install (e.g. west update was run before the helper
    needed it).  Rather than fail and ask the user to run pip manually, we
    attempt a single quiet pip install into the running interpreter and
    retry the import.  If the install also fails, the original ImportError
    is surfaced to the IDE.
    """
    try:
        import kconfiglib  # type: ignore  # noqa: F401
        return kconfiglib, None
    except Exception as first_err:  # noqa: BLE001
        try:
            subprocess.check_call(
                [sys.executable, "-m", "pip", "install", "--quiet", "kconfiglib"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.STDOUT,
            )
        except Exception:  # noqa: BLE001 - report the original ImportError
            return None, f"{type(first_err).__name__}: {first_err}"
        try:
            import kconfiglib  # type: ignore  # noqa: F401
            return kconfiglib, None
        except Exception as retry_err:  # noqa: BLE001
            return None, f"{type(retry_err).__name__}: {retry_err}"


# kconfiglib is part of the Zephyr Python requirements; if it's missing we
# attempt to install it once.  If that also fails, init() will surface a
# structured error with the original import message.
kconfiglib, _KCONFIGLIB_IMPORT_ERROR = _try_import_kconfiglib()


def _ensure_zephyr_kconfiglib() -> None:
    """Switch to Zephyr's patched kconfiglib if ZEPHYR_BASE is known.

    Zephyr ships its own fork of kconfiglib at
    ``$ZEPHYR_BASE/scripts/kconfig/`` that adds several non-upstream
    keywords (``configdefault``, ``osource``, ``orsource``, etc.)  used
    throughout the Zephyr tree, including NCS shields.  The pip-distributed
    kconfiglib does not support these keywords and will raise a
    ``KconfigError`` when it encounters them.

    This function must be called AFTER the Zephyr env vars have been
    applied to ``os.environ`` (i.e. inside ``Session.init``, not at module
    load time when ZEPHYR_BASE is not yet available).
    """
    global kconfiglib  # noqa: PLW0603
    import importlib

    zephyr_base = os.environ.get("ZEPHYR_BASE", "")
    if not zephyr_base:
        return

    kconfig_scripts = os.path.join(zephyr_base, "scripts", "kconfig")
    if not os.path.isdir(kconfig_scripts):
        return

    norm = os.path.normcase
    # Already first on path and same module - nothing to do.
    if kconfiglib is not None and sys.path and norm(sys.path[0]) == norm(kconfig_scripts):
        return

    # Prepend so this shadows any pip-installed kconfiglib.
    if norm(kconfig_scripts) not in [norm(p) for p in sys.path]:
        sys.path.insert(0, kconfig_scripts)
    elif sys.path[0] != kconfig_scripts:
        # Ensure it comes first even if already present elsewhere.
        sys.path.insert(0, kconfig_scripts)

    # Force a reload so the patched version replaces the pip one.
    try:
        if "kconfiglib" in sys.modules:
            kconfiglib = importlib.reload(sys.modules["kconfiglib"])
        else:
            import kconfiglib as _kc  # type: ignore  # noqa: F401
            kconfiglib = _kc
        _log("info", f"Using Zephyr kconfiglib from {kconfig_scripts}")
    except Exception as exc:  # noqa: BLE001
        _log(
            "warn", f"Could not load Zephyr kconfiglib from {kconfig_scripts}: {exc}")


def _find_module_kconfig(module_dir: str) -> Optional[str]:
    """Return the Kconfig file for a module directory, or None.

    Checks ``module.yml`` / ``zephyr/module.yml`` for a custom ``build.kconfig``
    path first, then falls back to the conventional locations.
    """
    for yml_rel in ("zephyr/module.yml", "module.yml"):
        yml_path = os.path.join(module_dir, yml_rel)
        if os.path.isfile(yml_path):
            try:
                content = open(yml_path, encoding="utf-8",
                               errors="replace").read()
                # Simple line-based extraction; avoids a YAML dependency.
                m = re.search(
                    r'^\s*kconfig:\s*[\'"]?([^\s\'"#]+)', content, re.MULTILINE)
                if m:
                    rel = m.group(1).strip("\'\"")
                    full = os.path.normpath(os.path.join(module_dir, rel))
                    if os.path.isfile(full):
                        return full
            except OSError:
                pass
    for rel in ("Kconfig", "zephyr/Kconfig"):
        p = os.path.join(module_dir, rel)
        if os.path.isfile(p):
            return p
    return None


def _resolve_module_kconfig_vars() -> None:
    """Resolve ZEPHYR_*_KCONFIG env vars from ZEPHYR_MODULES.

    ``ZEPHYR_MODULES`` is a semicolon-separated list of module root
    directories stored as a CMake CACHE INTERNAL variable, so it IS
    written to CMakeCache.txt and is available in our env dict.

    For each directory Zephyr derives the env var name as::

        ZEPHYR_<BASENAME_UPPER>_KCONFIG

    where ``BASENAME_UPPER`` is the directory's basename uppercased with
    non-alphanumeric characters replaced by underscores (matching CMake's
    own ``string(TOUPPER ...)`` behaviour).

    This must be called BEFORE ``_seed_module_kconfig_vars`` so real
    paths are set before the sentinel fallback runs.
    """
    modules_str = os.environ.get("ZEPHYR_MODULES", "")
    extra_str = os.environ.get("ZEPHYR_EXTRA_MODULES", "")
    dirs: List[str] = []
    for s in (modules_str, extra_str):
        dirs.extend(d.strip() for d in s.split(";") if d.strip())
    if not dirs:
        return

    resolved: List[str] = []
    for module_dir in dirs:
        if not os.path.isdir(module_dir):
            continue
        basename = os.path.basename(module_dir.rstrip("/\\"))
        # Match CMake's string(TOUPPER ...) + non-alphanumeric → underscore
        name_upper = re.sub(r'[^A-Z0-9]', '_', basename.upper())
        var_name = f"ZEPHYR_{name_upper}_KCONFIG"
        if var_name in os.environ:
            continue  # already set; don't clobber
        kconfig_path = _find_module_kconfig(module_dir)
        if kconfig_path:
            os.environ[var_name] = kconfig_path
            resolved.append(var_name)

    if resolved:
        _log(
            "info", f"Resolved {len(resolved)} module Kconfig paths from ZEPHYR_MODULES")


def _seed_module_kconfig_vars(seeded_out: Optional[Set[str]] = None) -> None:
    """Pre-populate unset $(VAR) references found in generated Kconfig files.

    Zephyr's CMake generates ``KCONFIG_BINARY_DIR/Kconfig.modules`` (and
    similar files) that use ::

        osource "$(ZEPHYR_FOO_KCONFIG)"
        orsource "$(ZEPHYR_BAR_KCONFIG)"

    for each registered module.  CMake passes the actual paths as env vars
    when it invokes kconfig.py, but those vars are NOT stored in
    ``CMakeCache.txt`` and are therefore absent from our subprocess.

    When a variable is unset, ``$(ZEPHYR_FOO_KCONFIG)`` expands to ``""``.
    kconfiglib then resolves the empty string relative to ``srctree``, giving
    a path like ``srctree/`` that *exists* as a directory on disk.  Zephyr's
    ``osource`` implementation uses ``os.path.isfile()`` (or similar) and on
    some versions falls through to trying to open a directory as a Kconfig
    file, raising ``_KconfigIOError`` instead of silently skipping.

    Seeding any unset variable with a path that is guaranteed not to exist
    as a file causes ``osource``/``orsource`` to skip them correctly.

    If ``seeded_out`` is provided it is populated with the names of variables
    that were seeded so the caller can clear them before the next reload.
    """
    kconfig_bin_dir = os.environ.get("KCONFIG_BINARY_DIR", "")
    if not kconfig_bin_dir or not os.path.isdir(kconfig_bin_dir):
        return

    # Sentinel: an absolute path inside KCONFIG_BINARY_DIR that is never
    # created during a Zephyr build, so os.path.isfile() always returns False.
    sentinel = os.path.join(kconfig_bin_dir, "__zephyr_ide_unset__.Kconfig")

    patched: List[str] = []
    try:
        for fname in sorted(os.listdir(kconfig_bin_dir)):
            # Only scan generated Kconfig files in this directory.
            if not (fname.startswith("Kconfig.") or fname.endswith(".Kconfig")):
                continue
            fpath = os.path.join(kconfig_bin_dir, fname)
            if not os.path.isfile(fpath):
                continue
            try:
                content = open(fpath, encoding="utf-8",
                               errors="replace").read()
            except OSError:
                continue
            for var in re.findall(r'\$\(([A-Z][A-Z0-9_]+)\)', content):
                if var not in os.environ:
                    os.environ[var] = sentinel
                    patched.append(var)
                    if seeded_out is not None:
                        seeded_out.add(var)
    except OSError:
        return

    if patched:
        unique = sorted(set(patched))
        summary = ", ".join(unique[:6])
        if len(unique) > 6:
            summary += f" … (+{len(unique) - 6} more)"
        _log(
            "info", f"Seeded {len(unique)} unset Kconfig module vars with sentinel: {summary}")


# ---------------------------------------------------------------------------
# Output helpers
# ---------------------------------------------------------------------------

def _write(obj: Dict[str, Any]) -> None:
    """Writes a single-line JSON object to stdout and flushes."""
    sys.stdout.write(json.dumps(obj, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def _log(level: str, message: str) -> None:
    _write({"event": "log", "level": level, "message": message})


# ---------------------------------------------------------------------------
# Board defconfig path resolution
# ---------------------------------------------------------------------------

def _resolve_board_defconfig() -> Optional[str]:
    """Resolve the path to the board's defconfig file.

    Zephyr stores board defconfig files at::

        <BOARD_DIR>/<BOARD>_defconfig

    where BOARD_DIR is a CACHE INTERNAL variable set by Zephyr's boards.cmake.
    If BOARD_DIR is not available in the environment, we attempt to locate
    the defconfig by scanning the board directories under ZEPHYR_BASE.

    Returns the absolute path to the defconfig file, or None if it cannot
    be resolved.
    """
    board = os.environ.get("BOARD")
    if not board:
        return None

    # Fast path: BOARD_DIR is extracted from CMakeCache.txt by
    # buildEnvFromCMakeCache and set in the env dict passed to init.
    board_dir = os.environ.get("BOARD_DIR")
    if board_dir and os.path.isdir(board_dir):
        candidate = os.path.join(board_dir, f"{board}_defconfig")
        if os.path.isfile(candidate):
            return os.path.normpath(candidate)

    # Fallback: scan the <board>/<board>_defconfig convention under
    # ZEPHYR_BASE/boards/<arch>/.
    zephyr_base = os.environ.get("ZEPHYR_BASE")
    if not zephyr_base:
        return None

    boards_dir = os.path.join(zephyr_base, "boards")
    if not os.path.isdir(boards_dir):
        return None

    try:
        for arch in sorted(os.listdir(boards_dir)):
            arch_dir = os.path.join(boards_dir, arch)
            if not os.path.isdir(arch_dir):
                continue
            candidate = os.path.join(arch_dir, board, f"{board}_defconfig")
            if os.path.isfile(candidate):
                return os.path.normpath(candidate)
    except OSError:
        pass

    return None


# ---------------------------------------------------------------------------
# Session state
# ---------------------------------------------------------------------------

class Session:
    """Holds the current Kconfig instance and original-value snapshot."""

    def __init__(self) -> None:
        self.kconf: Optional["kconfiglib.Kconfig"] = None
        self.kconfig_root: Optional[str] = None
        self.env_overrides: Dict[str, str] = {}
        self.dot_config: Optional[str] = None
        # Snapshot of values right after the .config (or defaults) load -
        # used to compute diffs and to drive the "minimal save" mode.
        self.original_values: Dict[str, str] = {}
        # Names of symbols explicitly set by the user via set() during this
        # session.  Only these are written to a saved fragment — cascade
        # changes (symbols that changed as side-effects of user changes) are
        # intentionally excluded because Kconfig will recompute them when the
        # fragment is applied to a fresh build.
        self.user_set_syms: Set[str] = set()
        # Vars that were seeded with the sentinel by _seed_module_kconfig_vars
        # during the last init.  Cleared at the start of each reload so that
        # new modules added between builds get correctly resolved rather than
        # being stuck with the sentinel value.
        self._seeded_sentinel_vars: Set[str] = set()
        # Path to the board defconfig file that was loaded during init.
        self._board_defconfig_path: Optional[str] = None

    def _load_board_defconfig(self) -> None:
        """Load the board's defconfig file as the base configuration.

        In Zephyr's standard build flow, the board defconfig is loaded FIRST
        as the baseline.  Application-level fragments (prj.conf, EXTRA_CONF_FILE)
        are layered on top of it, and the final merged result is written to
        .config.

        By loading the board defconfig before .config, we ensure that:
        1. Board-specific symbol values are always present in the editor tree,
           even when no .config exists yet (pre-build or cleaned build).
        2. The in-memory state accurately reflects what the Zephyr build system
           would produce: board defaults are the baseline, with .config values
           (which include application fragments and previous menuconfig edits)
           overlaying on top.

        Uses replace=False so the board defconfig values are merged into the
        fresh Kconfig tree without resetting any previously loaded state.
        Since this is called immediately after parsing (there are no user_values
        yet), replace=False is equivalent to replace=True in effect — it sets
        user_values from the defconfig file without clearing anything first.
        """
        assert self.kconf is not None
        board_def = _resolve_board_defconfig()
        if not board_def:
            _log("info",
                 "Board defconfig not found — using Kconfig defaults and .config only")
            return

        self._board_defconfig_path = board_def
        _log("info", f"Loading board defconfig: {board_def}")
        self.kconf.load_config(board_def, replace=False)

    # -- Loading ----------------------------------------------------------

    def init(self, params: Dict[str, Any]) -> Dict[str, Any]:
        if kconfiglib is None:
            raise RuntimeError(
                f"kconfiglib could not be imported ({_KCONFIGLIB_IMPORT_ERROR}). "
                "Make sure the Zephyr venv is active and `pip install kconfiglib` "
                "has succeeded."
            )

        kconfig_root = params.get("kconfig_root")
        if not kconfig_root or not os.path.isfile(kconfig_root):
            raise FileNotFoundError(
                f"kconfig_root does not exist: {kconfig_root!r}"
            )

        env = params.get("env") or {}
        if not isinstance(env, dict):
            raise TypeError("`env` must be an object of string -> string")

        # Apply env vars BEFORE parsing - kconfiglib reads many of them
        # (ZEPHYR_BASE, ARCH, BOARD, SOC_*, srctree, ...) at parse time.
        for key, value in env.items():
            os.environ[str(key)] = str(value)

        srctree = params.get("srctree") or env.get("srctree") or os.path.dirname(
            kconfig_root
        )
        os.environ.setdefault("srctree", srctree)

        self.kconfig_root = kconfig_root
        self.env_overrides = {str(k): str(v) for k, v in env.items()}
        self.dot_config = params.get("dot_config")

        # Upgrade to Zephyr's patched kconfiglib once ZEPHYR_BASE is in
        # os.environ.  Zephyr's fork supports `configdefault`, `osource`,
        # `orsource` and other non-upstream keywords used by NCS shields and
        # Zephyr boards.  The pip version raises KconfigError on them.
        _ensure_zephyr_kconfiglib()

        # Resolve ZEPHYR_*_KCONFIG paths from the module directories listed in
        # ZEPHYR_MODULES before falling back to the sentinel.  This populates
        # the module Kconfig tree so the "Modules" section is not empty.
        _resolve_module_kconfig_vars()

        # Pre-seed any remaining $(ZEPHYR_*_KCONFIG) vars that are still unset
        # after the resolution pass above (e.g. external modules not listed in
        # ZEPHYR_MODULES, or non-module vars).  Without this, empty expansions
        # resolve to `srctree/` causing _KconfigIOError in osource.
        # Track which vars are seeded so reload() can clear them and allow
        # re-resolution (important when new modules are added between builds).
        self._seeded_sentinel_vars = set()
        _seed_module_kconfig_vars(self._seeded_sentinel_vars)

        # Diagnostic: log KCONFIG_BINARY_DIR and whether Kconfig.dts exists so
        # issues with DT-derived symbols (DT_HAS_*) are easy to diagnose.
        kconfig_bin_dir = os.environ.get("KCONFIG_BINARY_DIR", "")
        if kconfig_bin_dir:
            kconfig_dts = os.path.join(kconfig_bin_dir, "Kconfig.dts")
            if os.path.isfile(kconfig_dts):
                _log(
                    "info", f"KCONFIG_BINARY_DIR={kconfig_bin_dir!r} (Kconfig.dts found)")
            else:
                _log("warn",
                     f"KCONFIG_BINARY_DIR={kconfig_bin_dir!r} but Kconfig.dts not found — "
                     "DT_HAS_* symbols will be missing. "
                     "Re-run a clean build and reload the Kconfig view.")
        else:
            _log("warn",
                 "KCONFIG_BINARY_DIR is not set — DT_HAS_* symbols will be missing. "
                 "Re-run a clean build and reload the Kconfig view.")

        # warn=False keeps the helper quiet; warnings would otherwise be
        # written to stderr and the IDE has no use for them today.
        self.kconf = kconfiglib.Kconfig(kconfig_root, warn=False)

        # -------------------------------------------------------------------
        # Configuration loading order (mirrors Zephyr's kconfig.cmake)
        # -------------------------------------------------------------------
        # 1. Load board defconfig as the baseline configuration.  This ensures
        #    board-specific values (BOARD_*, SOC_*, etc.) are set even when
        #    .config does not yet exist (pre-build scenario).
        self._load_board_defconfig()

        # 2. Load the existing .config (if any) on top of the board defconfig.
        #    .config represents the merged output of a previous build, including
        #    prj.conf, EXTRA_CONF_FILE fragments, and any previous menuconfig
        #    edits.  Using replace=True here ensures that all symbols are
        #    reset to their Kconfig defaults first, then the .config values
        #    are applied.  This correctly handles symbols that were removed
        #    from .config between builds (they fall back to board defconfig
        #    values, not Kconfig defaults).
        if self.dot_config and os.path.isfile(self.dot_config):
            self.kconf.load_config(self.dot_config, replace=True)

        self._snapshot_values()

        return {
            "symbols": len(self.kconf.unique_defined_syms),
            "menus": self._count_menus(),
            "top_menu": self._serialize_node(self.kconf.top_node, depth=1),
            "kconfig_root": self.kconfig_root,
            "dot_config_loaded": bool(
                self.dot_config and os.path.isfile(self.dot_config)
            ),
            "board_defconfig_loaded": self._board_defconfig_path is not None,
        }

    def reload(self) -> Dict[str, Any]:
        if self.kconfig_root is None:
            raise RuntimeError("reload called before init")
        # Clear any sentinel values that were injected during the previous init
        # so _resolve_module_kconfig_vars() can re-resolve them with real paths.
        # This matters when new Zephyr modules are added between builds.
        for var in self._seeded_sentinel_vars:
            os.environ.pop(var, None)
        self._seeded_sentinel_vars = set()
        return self.init(
            {
                "kconfig_root": self.kconfig_root,
                "env": self.env_overrides,
                "dot_config": self.dot_config,
            }
        )

    def _snapshot_values(self) -> None:
        assert self.kconf is not None
        self.original_values = {
            sym.name: sym.str_value for sym in self.kconf.unique_defined_syms
        }
        # Clear the user-set tracking on every (re)load so a Reload in the
        # UI resets which symbols are considered "session changes".
        self.user_set_syms = set()

    def _count_menus(self) -> int:
        assert self.kconf is not None
        count = 0
        node = self.kconf.top_node.list
        stack = []
        while node:
            if node.item is kconfiglib.MENU:
                count += 1
            if node.list:
                stack.append(node.next)
                node = node.list
            else:
                node = node.next
            while node is None and stack:
                node = stack.pop()
        return count

    # -- Tree traversal ---------------------------------------------------

    def tree(self) -> Dict[str, Any]:
        assert self.kconf is not None
        return {"top_menu": self._serialize_node(self.kconf.top_node, depth=-1)}

    def _serialize_node(self, node: Any, depth: int) -> Dict[str, Any]:
        """
        Serializes a MenuNode and its children.  `depth` controls recursion:
        -1 means unbounded; 0 means no children; positive means N levels of
        children.
        """
        if node is None:
            return {}
        is_menu = node.item is kconfiglib.MENU
        is_choice = isinstance(node.item, kconfiglib.Choice)
        is_symbol = isinstance(node.item, kconfiglib.Symbol)
        item_name = ""
        item_type = ""
        value = ""
        visible = bool(node.prompt) and bool(getattr(node, "visibility", 1))
        if is_symbol:
            sym = node.item
            item_name = sym.name
            item_type = kconfiglib.TYPE_TO_STR.get(sym.type, "unknown")
            value = sym.str_value
            visible = sym.visibility != 0
        elif is_choice:
            item_name = node.item.name or ""
            item_type = "choice"
            value = node.item.selection.name if node.item.selection else ""
            # Choice visibility: the choice itself has a .visibility property.
            visible = node.item.visibility != 0
        elif is_menu:
            # MenuNode for a `menu` block does NOT have a .visibility attribute
            # in kconfiglib — getattr would silently return the default 1 and
            # make every menu appear visible regardless of its `depends on`.
            # Evaluate the node's immediate dependency expression instead.
            visible = bool(node.prompt) and kconfiglib.expr_value(node.dep) > 0

        out: Dict[str, Any] = {
            "id": id(node),
            "prompt": node.prompt[0] if node.prompt else "",
            "name": item_name,
            "type": item_type,
            "value": value,
            "visible": visible,
            "is_menu": is_menu,
            "is_choice": is_choice,
            "is_symbol": is_symbol,
        }
        # For choices and menus expose the immediate dependency expression so
        # the UI can auto-enable guarding symbols when the user interacts with
        # a hidden node (e.g. selecting a C++ standard enables CONFIG_CPP).
        if is_choice or is_menu:
            dep_str = kconfiglib.expr_str(node.dep)
            if dep_str and dep_str != "y":
                out["direct_dep"] = dep_str

        if depth != 0 and node.list:
            children = []
            # Track symbol names already serialized at this level.  A symbol
            # can have multiple MenuNodes (one per `config`/`configdefault`
            # block in different files) and all of them appear in the sibling
            # chain.  We keep only the first node for each symbol name so the
            # tree does not show duplicates.  Menus and choices are always
            # kept because they are structurally unique.
            seen_sym_names: set = set()
            child = node.list
            while child:
                item = child.item
                if isinstance(item, kconfiglib.Symbol):
                    if item.name in seen_sym_names:
                        child = child.next
                        continue
                    seen_sym_names.add(item.name)
                children.append(self._serialize_node(
                    child, depth - 1 if depth > 0 else -1))
                child = child.next
            out["children"] = children
        return out

    # -- Symbol detail ----------------------------------------------------

    def symbol(self, name: str) -> Dict[str, Any]:
        assert self.kconf is not None
        sym = self.kconf.syms.get(name)
        if sym is None:
            raise KeyError(f"unknown symbol: {name!r}")

        defining_files: List[Dict[str, Any]] = []
        for n in sym.nodes:
            defining_files.append(
                {
                    "filename": n.filename,
                    "linenr": n.linenr,
                    "prompt": n.prompt[0] if n.prompt else "",
                }
            )

        # Defaults: list of (value-expr-as-str, condition-expr-as-str)
        defaults = [
            {
                "value": kconfiglib.expr_str(default[0]),
                "cond": kconfiglib.expr_str(default[1])
                if default[1] is not self.kconf.y
                else "y",
            }
            for default in sym.defaults
        ]

        # Ranges: list of (low-expr, high-expr, condition-expr)
        ranges = [
            {
                "low": kconfiglib.expr_str(rng[0]),
                "high": kconfiglib.expr_str(rng[1]),
                "cond": kconfiglib.expr_str(rng[2])
                if rng[2] is not self.kconf.y
                else "y",
            }
            for rng in sym.ranges
        ]

        return {
            "name": sym.name,
            "type": kconfiglib.TYPE_TO_STR.get(sym.type, "unknown"),
            "prompt": sym.nodes[0].prompt[0]
            if sym.nodes and sym.nodes[0].prompt
            else "",
            "help": "\n".join(n.help for n in sym.nodes if n.help) or "",
            "value": sym.str_value,
            "user_value": sym.user_value if sym.user_value is not None else None,
            "visible": sym.visibility != 0,
            "assignable_values": list(sym.assignable),
            "direct_dependencies": kconfiglib.expr_str(sym.direct_dep),
            "defaults": defaults,
            "ranges": ranges,
            "defining_files": defining_files,
            "is_constant": sym.is_constant,
            "choice": sym.choice.name if sym.choice else None,
        }

    # -- Editing ----------------------------------------------------------

    def set(self, name: str, value: str) -> Dict[str, Any]:
        assert self.kconf is not None
        sym = self.kconf.syms.get(name)
        if sym is None:
            raise KeyError(f"unknown symbol: {name!r}")

        # Snapshot every symbol's value BEFORE the set so we can report
        # cascading changes.
        before = {s.name: s.str_value for s in self.kconf.unique_defined_syms}

        ok = sym.set_value(value)
        if not ok:
            raise ValueError(
                f"value {value!r} is not assignable to {name} (type "
                f"{kconfiglib.TYPE_TO_STR.get(sym.type, '?')}, "
                f"assignable={list(sym.assignable)})"
            )
        # Record that the user explicitly changed this symbol so save() can
        # write only user-initiated changes, not cascade side-effects.
        self.user_set_syms.add(name)

        changed: List[Dict[str, str]] = []
        for s in self.kconf.unique_defined_syms:
            new_value = s.str_value
            if before.get(s.name) != new_value:
                changed.append(
                    {
                        "name": s.name,
                        "old": before.get(s.name, ""),
                        "new": new_value,
                    }
                )
        return {"changed": changed}

    # -- Diff & save ------------------------------------------------------

    def diff(self) -> Dict[str, Any]:
        assert self.kconf is not None
        changes: List[Dict[str, str]] = []
        for s in self.kconf.unique_defined_syms:
            # Only report symbols the user explicitly set — same set that save()
            # will write.  Cascade side-effects are excluded so the UI change
            # count stays in sync with the saved fragment entry count.
            if s.name not in self.user_set_syms:
                continue
            if s.is_constant or not s.assignable:
                continue
            cur = s.str_value
            old = self.original_values.get(s.name, "")
            if cur != old:
                changes.append({"name": s.name, "old": old, "new": cur})
        return {"changes": changes}

    def save(self, path: str, minimal: bool = True) -> Dict[str, Any]:
        assert self.kconf is not None
        if not path:
            raise ValueError("save requires a non-empty `path`")
        # Make sure the parent directory exists - the IDE always asks via a
        # save dialog so this should normally be a no-op.
        parent = os.path.dirname(os.path.abspath(path))
        if parent:
            os.makedirs(parent, exist_ok=True)

        if minimal:
            # Write only the symbols the user explicitly set via set() during
            # this session.  Cascade changes (symbols that changed as
            # side-effects) are excluded — Kconfig recomputes them when the
            # fragment is applied.  We also skip any symbol that is no longer
            # user-settable (empty assignable tuple) to avoid writing computed
            # read-only values.
            lines: List[str] = [
                "# Kconfig fragment generated by Zephyr IDE\n",
                "# Contains only settings changed in this session.\n",
            ]
            for s in self.kconf.unique_defined_syms:
                if s.name not in self.user_set_syms:
                    continue
                # Skip symbols that cannot be set by the user (computed values).
                if s.is_constant or not s.assignable:
                    continue
                cur = s.str_value
                if s.type in (kconfiglib.BOOL, kconfiglib.TRISTATE):
                    if cur == "y":
                        lines.append(f"CONFIG_{s.name}=y\n")
                    elif cur == "m":
                        lines.append(f"CONFIG_{s.name}=m\n")
                    else:
                        lines.append(f"# CONFIG_{s.name} is not set\n")
                elif s.type == kconfiglib.HEX:
                    lines.append(f"CONFIG_{s.name}={cur}\n")
                else:
                    # STRING and INT — value is already the raw string.
                    lines.append(f"CONFIG_{s.name}={cur}\n")
            with open(path, "w", encoding="utf-8") as f:
                f.writelines(lines)
        else:
            self.kconf.write_config(path)
        return {"path": os.path.abspath(path)}

    # -- Search -----------------------------------------------------------

    def search(self, query: str, include_help: bool = True,
               include_hidden: bool = False, limit: int = 200) -> Dict[str, Any]:
        """
        Case-insensitive substring search across symbol name, prompt, and
        (optionally) help body.  Returns a flat list of hits ranked so that
        name matches sort first, then prompt matches, then help-only matches.
        """
        assert self.kconf is not None
        q = (query or "").strip().lower()
        if not q:
            return {"hits": []}

        hits: List[Dict[str, Any]] = []
        for sym in self.kconf.unique_defined_syms:
            if not include_hidden and sym.visibility == 0:
                # Still allow if name match was explicit (helpful for power users).
                if q not in sym.name.lower():
                    continue
            name = sym.name or ""
            prompt = ""
            help_body = ""
            for n in sym.nodes:
                if n.prompt and not prompt:
                    prompt = n.prompt[0]
                if include_help and n.help:
                    help_body += n.help + "\n"

            in_name = q in name.lower()
            in_prompt = q in prompt.lower()
            in_help = include_help and (q in help_body.lower())
            if not (in_name or in_prompt or in_help):
                continue

            # Lower rank = better match.
            rank = 3 if in_help and not (in_name or in_prompt) else (
                2 if in_prompt and not in_name else (
                    1 if in_name else 4
                )
            )
            hits.append({
                "name": name,
                "prompt": prompt,
                "type": kconfiglib.TYPE_TO_STR.get(sym.type, "unknown"),
                "value": sym.str_value,
                "visible": sym.visibility != 0,
                "matched_help": in_help and not (in_name or in_prompt),
                "rank": rank,
            })

        hits.sort(key=lambda h: (h["rank"], h["name"]))
        # Determine truncation from the pre-slice count so an exact-`limit`
        # result set is not falsely reported as truncated.
        truncated = limit > 0 and len(hits) > limit
        if limit > 0:
            hits = hits[:limit]
        return {"hits": hits, "truncated": truncated}


# ---------------------------------------------------------------------------
# Dispatcher
# ---------------------------------------------------------------------------

def _dispatch(session: Session, request: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    method = request.get("method")
    params = request.get("params") or {}

    if method == "init":
        return session.init(params)
    if method == "reload":
        return session.reload()
    if method == "tree":
        return session.tree()
    if method == "symbol":
        return session.symbol(params["name"])
    if method == "set":
        return session.set(params["name"], params["value"])
    if method == "diff":
        return session.diff()
    if method == "save":
        return session.save(params["path"], bool(params.get("minimal", True)))
    if method == "search":
        return session.search(
            params.get("query", ""),
            include_help=bool(params.get("include_help", True)),
            include_hidden=bool(params.get("include_hidden", False)),
            limit=int(params.get("limit", 200)),
        )
    if method == "shutdown":
        return {"ok": True}

    raise ValueError(f"unknown method: {method!r}")


def main() -> int:
    session = Session()
    _log("info", "kconfig_helper started")

    for raw in sys.stdin:
        line = raw.strip()
        if not line:
            continue
        try:
            request = json.loads(line)
        except json.JSONDecodeError as exc:
            _write({"id": None, "error": {"message": f"invalid JSON: {exc}"}})
            continue

        request_id = request.get("id")
        try:
            result = _dispatch(session, request)
            _write({"id": request_id, "result": result})
            if request.get("method") == "shutdown":
                return 0
        except Exception as exc:  # noqa: BLE001 - all failures become RPC errors
            _write(
                {
                    "id": request_id,
                    "error": {
                        "message": f"{type(exc).__name__}: {exc}",
                        "trace": traceback.format_exc(),
                    },
                }
            )
    return 0


if __name__ == "__main__":
    sys.exit(main())
