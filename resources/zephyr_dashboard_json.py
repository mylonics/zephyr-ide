# Copyright 2026 mylonics
# Author Rijesh Augustine
# SPDX-License-Identifier: Apache-2.0
#
# Zephyr IDE dashboard JSON extractor.
#
# Reads build artifacts directly from the Zephyr build directory — no
# dependency on the upstream scripts/dashboard/dashboard.py module.
# Works with any Zephyr version that produces a standard CMake build tree.

import argparse
import json
import logging
import re
import sys
from datetime import datetime
from pathlib import Path

log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _read_text(path: Path) -> str:
    """Read a text file, returning an empty string on any error."""
    try:
        return path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return ""


# ---------------------------------------------------------------------------
# CMake cache
# ---------------------------------------------------------------------------

def _parse_cmake_cache(build_dir: Path) -> dict:
    """Parse CMakeCache.txt and return a key→value mapping."""
    cache: dict = {}
    for line in _read_text(build_dir / "CMakeCache.txt").splitlines():
        line = line.strip()
        if line.startswith("//") or line.startswith("#") or "=" not in line:
            continue
        key_type, _, value = line.partition("=")
        key = key_type.split(":")[0]
        cache[key] = value
    return cache


# ---------------------------------------------------------------------------
# Kconfig
# ---------------------------------------------------------------------------

def _infer_kconfig_type(raw_value: str) -> str:
    """Guess a Kconfig symbol type from its raw .config value."""
    if raw_value in ("y", "n", "m"):
        return "bool"
    if re.fullmatch(r"0[xX][0-9a-fA-F]+", raw_value):
        return "hex"
    try:
        int(raw_value)
        return "int"
    except ValueError:
        pass
    return "string"


def _parse_kconfig(build_dir: Path) -> list:
    """Parse zephyr/.config and return a list of {name, value, type} dicts."""
    entries = []
    for line in _read_text(build_dir / "zephyr" / ".config").splitlines():
        line = line.strip()
        if line.startswith("# CONFIG_") and line.endswith(" is not set"):
            name = line[2:].removesuffix(" is not set")
            entries.append({"name": name, "value": "n", "type": "bool"})
        elif line.startswith("CONFIG_") and "=" in line:
            name, _, raw = line.partition("=")
            # Strip surrounding double-quotes for string values
            value = raw[1:-1] if raw.startswith('"') and raw.endswith('"') else raw
            entries.append({"name": name, "value": value, "type": _infer_kconfig_type(raw)})
    return entries


# ---------------------------------------------------------------------------
# ELF / stat file
# ---------------------------------------------------------------------------

_NM_TEXT_TYPES = frozenset("TtWw")
_NM_RODATA_TYPES = frozenset("Rr")
_NM_DATA_TYPES = frozenset("DdGgSs")
_NM_BSS_TYPES = frozenset("BbCc")


def _parse_memory_summary_from_stat(stat_path: Path) -> dict:
    """
    Summarise memory usage from a Zephyr .stat file.

    The .stat file is produced by ``nm --size-sort`` and has the format:
        <hex-size> <type-char> <symbol-name>
    """
    summary = {"bss": 0, "rodata": 0, "rwdata": 0, "text": 0, "other": 0}
    for line in _read_text(stat_path).splitlines():
        parts = line.split(None, 2)
        if len(parts) < 2:
            continue
        try:
            size = int(parts[0], 16)
        except ValueError:
            continue
        sym_type = parts[1]
        if sym_type in _NM_TEXT_TYPES:
            summary["text"] += size
        elif sym_type in _NM_RODATA_TYPES:
            summary["rodata"] += size
        elif sym_type in _NM_DATA_TYPES:
            summary["rwdata"] += size
        elif sym_type in _NM_BSS_TYPES:
            summary["bss"] += size
        else:
            summary["other"] += size
    return summary


def _get_elf_info(build_dir: Path, kernel_bin_name: str) -> dict:
    """Return ELF/bin file metadata and a memory summary dict."""
    elf_path = build_dir / "zephyr" / f"{kernel_bin_name}.elf"
    bin_path = build_dir / "zephyr" / f"{kernel_bin_name}.bin"
    hex_path = build_dir / "zephyr" / f"{kernel_bin_name}.hex"
    stat_path = build_dir / "zephyr" / f"{kernel_bin_name}.stat"

    elf_size = bin_size = elf_date = None

    if elf_path.exists():
        s = elf_path.stat()
        elf_size = f"{s.st_size:,} bytes"
        elf_date = datetime.fromtimestamp(s.st_mtime).strftime("%Y-%m-%d %H:%M:%S")

    if bin_path.exists():
        bin_size = f"{bin_path.stat().st_size:,} bytes"
    elif hex_path.exists():
        bin_size = f"{hex_path.stat().st_size:,} bytes (hex)"

    memory_summary = _parse_memory_summary_from_stat(stat_path)

    return {
        "elfSize": elf_size,
        "binSize": bin_size,
        "elfDate": elf_date,
        "statPath": str(stat_path),
        "statContents": _read_text(stat_path),
        "memorySummary": memory_summary,
    }


# ---------------------------------------------------------------------------
# Memory reports
# ---------------------------------------------------------------------------

def _try_load_memory_report(build_dir: Path, mem_type: str):
    """
    Attempt to read an existing *_report.json file produced by
    ``west build -t ram_report`` / ``west build -t rom_report``.
    Returns the parsed JSON dict, or None if the file is absent / unreadable.
    """
    candidates = [
        build_dir / "zephyr" / f"{mem_type}_report.json",
        build_dir / f"{mem_type}_report.json",
    ]
    for path in candidates:
        if path.is_file():
            try:
                return json.loads(path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError) as exc:
                log.debug("Could not load %s: %s", path, exc)
    return None


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def _parse_args():
    parser = argparse.ArgumentParser(allow_abbrev=False)
    parser.add_argument("--build-dir", required=True, help="Zephyr build directory")
    parser.add_argument("--output", required=True, help="Path to write the JSON payload")
    parser.add_argument("--kernel-bin-name", default="zephyr")
    parser.add_argument("-v", "--verbose", action="store_true")
    return parser.parse_args()


def main():
    args = _parse_args()
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(levelname)s: %(message)s",
    )

    build_dir = Path(args.build_dir).resolve()
    output_path = Path(args.output).resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)

    # --- Summary ---
    cache = _parse_cmake_cache(build_dir)
    board = cache.get("BOARD") or cache.get("CACHED_BOARD")
    app_dir = cache.get("APPLICATION_SOURCE_DIR")
    zephyr_version = (
        cache.get("ZEPHYR_VERSION_STRING")
        or cache.get("Zephyr_VERSION")
        or "unknown"
    )
    toolchain = cache.get("ZEPHYR_TOOLCHAIN_VARIANT") or "unknown"

    elf_info = _get_elf_info(build_dir, args.kernel_bin_name)

    # --- Kconfig ---
    kconfig = _parse_kconfig(build_dir)

    # --- Device tree ---
    dts_path = build_dir / "zephyr" / "zephyr.dts"
    dts_source = _read_text(dts_path)

    # --- Memory reports (optional, from prior ram/rom_report runs) ---
    memory = {
        mem_type: _try_load_memory_report(build_dir, mem_type)
        for mem_type in ("all", "ram", "rom")
    }

    payload = {
        "summary": {
            "board": board,
            "application": app_dir,
            "command": None,
            "zephyrVersion": zephyr_version,
            "toolchain": toolchain,
            "elfDate": elf_info["elfDate"],
            "elfSize": elf_info["elfSize"],
            "binSize": elf_info["binSize"],
            "memorySummary": elf_info["memorySummary"],
        },
        "kconfig": kconfig,
        "sysInit": {
            "errors": [],
            "levels": {},
        },
        "memory": memory,
        "dts": {
            "source": dts_source,
            "sourcePath": str(dts_path),
        },
        "elfStats": {
            "contents": elf_info["statContents"],
            "path": elf_info["statPath"],
        },
    }

    output_path.write_text(json.dumps(payload), encoding="utf-8")
    log.info("Wrote dashboard JSON: %s", output_path)


if __name__ == "__main__":
    main()
