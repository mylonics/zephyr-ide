# Copyright 2026 mylonics
# Author Rijesh Augustine
# SPDX-License-Identifier: Apache-2.0
#
# Zephyr IDE dashboard JSON extractor.
#
# Imports the upstream `scripts/dashboard/dashboard.py` from the active Zephyr
# install and reuses its data-collection methods (ELF parsing, Kconfig trace,
# device-tree parsing, sys-init validation, memory size reports) to emit a
# single unified JSON document describing the build.  No HTML is generated;
# rendering is performed natively by the Zephyr IDE webview.

import argparse
import json
import logging
import os
import re
import sys
from pathlib import Path


def _import_dashboard(zephyr_base: Path):
    """Import the upstream dashboard.py module from the given Zephyr base."""
    dashboard_dir = zephyr_base / "scripts" / "dashboard"
    if not dashboard_dir.is_dir():
        raise SystemExit(f"Upstream dashboard module not found at {dashboard_dir}")
    sys.path.insert(0, str(dashboard_dir))
    import dashboard  # noqa: E402
    return dashboard


def _safe(value):
    """Convert non-JSON-serialisable scalars to strings."""
    if value is None or isinstance(value, (str, int, float, bool, list, dict)):
        return value
    return str(value)


def _kconfig_to_dict(sym):
    """Convert a KconfigSymbol object into a plain dict."""
    return {
        "name": _safe(sym.name),
        "type": _safe(sym.sym_type),
        "value": _safe(sym.value),
        "src": _safe(sym.src),
        "visible": bool(sym.visible),
        "locHtml": sym.loc_html(),
        "srcHtml": sym.src_html(),
    }


def _sysinit_to_dict(levels):
    """Flatten the {level: [Initlevel...]} structure into JSON-friendly form."""
    out = {}
    for level_name, entries in (levels or {}).items():
        items = []
        for entry in entries or []:
            items.append({
                "name": _safe(getattr(entry, "name", entry)),
                "priority": _safe(getattr(entry, "priority", None)),
                "ordinal": _safe(getattr(entry, "ordinal", None)),
                "path": _safe(getattr(entry, "path", None)),
            })
        out[str(level_name)] = items
    return out


def _read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except OSError:
        return ""


def _build_payload(dash) -> dict:
    """Assemble the JSON payload from a constructed ZephyrDashboard instance."""

    payload = {
        "summary": {
            "board": _safe(dash.board),
            "application": _safe(dash.application),
            "command": _safe(dash.command),
            "zephyrVersion": str(dash.zephyr_version),
            "toolchain": str(dash.toolchain),
            "elfDate": _safe(dash.elf_date_str),
            "elfSize": _safe(dash.elf_size_str),
            "binSize": _safe(dash.bin_size_str),
            "memorySummary": dash.memory_summary,
        },
        "kconfig": [_kconfig_to_dict(sym) for sym in (dash.kconfigs or [])],
        "sysInit": {
            "errors": list(dash.sys_init_errors or []),
            "levels": _sysinit_to_dict(dash.sys_init_levels),
        },
    }

    # Memory reports — load the JSON files the upstream script generates.
    memory = {}
    for mem_type in ("all", "ram", "rom"):
        report_file = dash.output_path / f"{mem_type}_report.json"
        if report_file.is_file():
            try:
                memory[mem_type] = json.loads(report_file.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                memory[mem_type] = None
        else:
            memory[mem_type] = None
    payload["memory"] = memory

    # Device tree — both the structured EDT tree and the raw .dts source.
    try:
        edt_tree = dash._edt_fancytree()
    except Exception as e:  # pylint: disable=broad-except
        edt_tree = {"tree": [], "label2path": {}, "error": str(e)}
    payload["dts"] = {
        "tree": edt_tree,
        "source": _read_text(dash.dts_file),
        "sourcePath": str(dash.dts_file),
    }

    # ELF stats (`zephyr.stat`) raw text.
    stat_path = dash.build_path / "zephyr" / f"{dash.kernel_bin_name}.stat"
    payload["elfStats"] = {
        "contents": _read_text(stat_path),
        "path": str(stat_path),
    }

    return payload


def _parse_args():
    parser = argparse.ArgumentParser(allow_abbrev=False)
    parser.add_argument("--build-dir", required=True, help="Zephyr build directory")
    parser.add_argument("--zephyr-base", required=True, help="Zephyr base directory")
    parser.add_argument("--output", required=True, help="Path to write the JSON payload")
    parser.add_argument("--kernel-bin-name", default="zephyr")
    parser.add_argument("--skip-memory-report", action="store_true",
                        help="Skip generating ram/rom/all JSON reports if missing")
    parser.add_argument("-v", "--verbose", action="store_true")
    return parser.parse_args()


def main():
    args = _parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(levelname)s: %(message)s",
    )

    zephyr_base = Path(args.zephyr_base).resolve()
    build_dir = Path(args.build_dir).resolve()
    output_path = Path(args.output).resolve()
    output_dir = output_path.parent

    dashboard = _import_dashboard(zephyr_base)

    output_dir.mkdir(parents=True, exist_ok=True)

    # Reuse upstream ZephyrDashboard for data extraction; output_path here is
    # where size_report writes ram/rom/all JSON files.
    dash = dashboard.ZephyrDashboard(
        zephyr_base=zephyr_base,
        build_path=build_dir,
        output_path=output_dir,
        kernel_bin_name=args.kernel_bin_name,
        skip_memory_report=args.skip_memory_report,
    )

    payload = _build_payload(dash)

    output_path.write_text(json.dumps(payload), encoding="utf-8")
    print(f"Wrote dashboard JSON: {output_path}")


if __name__ == "__main__":
    main()
