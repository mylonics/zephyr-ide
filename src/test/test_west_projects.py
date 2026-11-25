# SPDX-License-Identifier: Apache-2.0
"""Offline west module picker regression cases. Run with the workspace's west Python."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

import yaml

HELPER = Path(__file__).resolve().parents[2] / "resources" / "west_projects.py"


def run(cwd, *cmd, data=None, check=True):
    return subprocess.run(cmd, cwd=cwd, check=check, capture_output=True, encoding="utf-8",
                          env={**os.environ, "PYTHONIOENCODING": "utf-8"},
                          input=json.dumps(data) if data is not None else None)


def repository(root, name, files):
    repo = root / name
    repo.mkdir()
    run(repo, "git", "init", "-q")
    for filename, content in files.items():
        (repo / filename).parent.mkdir(parents=True, exist_ok=True)
        (repo / filename).write_text(content, encoding="utf-8")
    run(repo, "git", "add", ".")
    run(repo, "git", "-c", "user.name=Test", "-c", "user.email=test@example.org",
        "commit", "-qm", "Add test fixture")
    return {"name": name, "url": repo.as_uri(),
            "revision": run(repo, "git", "rev-parse", "HEAD").stdout.strip()}


class WestProjectsTest(unittest.TestCase):
    def test_dependency_downloads_and_version_checks(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            lib = repository(root, "alpha", {"zephyr/module.yml": "build: {depends: [beta]}"})
            beta = repository(root, "beta", {"file": "v1"})
            unused = repository(root, "optional", {"file": "skip"})
            ws = root / "west 工作区"
            app = ws / "application"
            app.mkdir(parents=True)
            (app / "west.yml").write_text(yaml.safe_dump({"manifest": {"projects": [
                {**lib, "revision": "HEAD"}, beta, unused]}}))
            (app / "modules/alpha").mkdir(parents=True)
            (app / "modules/alpha/Kconfig").write_text("config ALPHA\n    bool\n")
            (app / "prj.conf").write_text("CONFIG_ALPHA=y\nCONFIG_OPTIONAL=n\n")
            (app / "CMakeLists.txt").write_text("if(CONFIG_OPTIONAL)\nset(X ${ZEPHYR_OPTIONAL_MODULE_DIR})\nendif()\n")
            run(ws, sys.executable, "-m", "west", "init", "-l", str(app))

            def call(action, data=None):
                return json.loads(run(ws, sys.executable, str(HELPER), action, data=data).stdout)

            def missing():
                return [p["name"] for p in call("dependencies", {"application": str(app)})["projects"] if p["missing"]]

            def rows():
                return {p["name"]: p for p in call("list")["projects"]}

            self.assertEqual(missing(), ["alpha"])
            self.assertEqual(rows()["alpha"]["checkout"]["state"], "absent")
            run(ws, sys.executable, str(HELPER), "update", "--", "alpha")
            self.assertEqual(missing(), ["beta"])
            run(ws, sys.executable, str(HELPER), "update", "--", "beta")
            self.assertEqual(missing(), [])
            result = {p["name"]: p for p in call("dependencies", {"application": str(app)})["projects"]}
            self.assertEqual(result["alpha"]["requiredBy"], ["application"])
            self.assertEqual(result["beta"]["requiredBy"], ["alpha"])
            self.assertEqual(result["alpha"]["sources"], ["app/prj.conf (CONFIG_ALPHA=y)"])
            self.assertEqual(result["beta"]["sources"], ["alpha/zephyr/module.yml"])
            for module_path in (ws / "optional", app / ".." / "optional"):
                with self.subTest(module_path=module_path):
                    explicit = call("dependencies", {"application": str(app), "cmakeArgs": [
                        "-DZEPHYR_MODULES=" + str(module_path)]})
                    by_name = {p["name"]: p["sources"] for p in explicit["projects"]}
                    self.assertEqual(by_name["optional"], ["-DZEPHYR_MODULES"])
            self.assertEqual(result["beta"]["revision"], beta["revision"])
            self.assertFalse((ws / "optional").exists())
            alpha = rows()["alpha"]
            self.assertEqual(alpha["checkout"]["head"], call("remote-revision", alpha)["sha"])
            repo = root / "alpha"
            run(repo, "git", "-c", "user.name=Test", "-c", "user.email=a@b", "commit", "--allow-empty", "-m", "change")
            remote = call("remote-revision", alpha)
            self.assertNotEqual(remote["sha"], alpha["checkout"]["head"])
            self.assertIn("checkedAt", remote)
            self.assertEqual(rows()["beta"]["checkout"]["head"], beta["revision"])
            self.assertEqual(rows()["alpha"]["checkout"]["head"], alpha["checkout"]["head"])
            # A changed manifest pin can advance a pristine west-managed checkout.
            manifest = app / "west.yml"
            entries = yaml.safe_load(manifest.read_text())
            entries["manifest"]["projects"][0]["revision"] = remote["sha"]
            manifest.write_text(yaml.safe_dump(entries))
            def alignable():
                report = call("dependencies", {"application": str(app)})
                return [p["name"] for p in report["projects"] if p["needsUpdate"]]
            self.assertEqual(alignable(), ["alpha"])
            (ws / "alpha/local.txt").write_text("developer changes")
            self.assertEqual(alignable(), [])
            entries["manifest"]["projects"][0]["revision"] = "HEAD"
            manifest.write_text(yaml.safe_dump(entries))
            repo.rename(root / "offline")
            self.assertEqual(call("remote-revision", alpha)["error"], "unavailable")

    def test_cortex_m_board_resolves_cmsis6_without_legacy_cmsis(self):
        with tempfile.TemporaryDirectory() as temp:
            ws = Path(temp)
            zephyr = ws / "zephyr"
            board_dir = zephyr / "boards" / "board_maker" / "demo"
            soc_dir = zephyr / "soc" / "xhsc" / "hc32"
            integration = zephyr / "modules" / "cmsis_6"
            for directory in (board_dir, soc_dir, integration):
                directory.mkdir(parents=True)
            (board_dir / "board.yml").write_text("board: {name: demo, socs: [{name: hc32m4}]}")
            (soc_dir / "soc.yml").write_text("family: [{name: xhsc, socs: [{name: hc32m4}]}]")
            (soc_dir / "Kconfig").write_text("config SOC_HC32M4\n    select CMSIS_CORE_HAS_SYSTEM_CORE_CLOCK\n")
            (integration / "Kconfig").write_text("config CMSIS_CORE_HAS_SYSTEM_CORE_CLOCK\n    bool\n")
            (soc_dir / "CMakeLists.txt").write_text("set(DDL ${ZEPHYR_HAL_XHSC_MODULE_DIR}/hc32_ddl)")
            names = ["cmsis", "cmsis_6"]
            manifest = zephyr / "west.yml"
            manifest.write_text(yaml.safe_dump({"manifest": {"projects": [
                {"name": name, "url": "https://example.org/" + name} for name in names]}}))
            run(ws, sys.executable, "-m", "west", "init", "-l", str(zephyr))
            inputs = {"application": str(ws), "board": "demo", "zephyr": str(zephyr)}
            def detect():
                return json.loads(run(ws, sys.executable, str(HELPER), "dependencies", data=inputs).stdout)
            result = detect()
            self.assertEqual([p["name"] for p in result["projects"]], ["cmsis_6"])
            self.assertEqual(result["unknown"], ["hal_xhsc"])
            self.assertEqual(result["unresolved"][0]["requiredBy"], ["hc32m4"])
            self.assertEqual(result["projects"][0]["requiredBy"], ["hc32m4"])
            self.assertTrue(any("Kconfig" in ref for ref in result["projects"][0]["sources"]))
            # A manifest entry or a matching family name alone is not a build dependency.
            registry = yaml.safe_load(manifest.read_text())
            registry["manifest"]["projects"].append({"name": "hal_xhsc", "url": "https://example.org/hal", "revision": "v1.2"})
            manifest.write_text(yaml.safe_dump(registry))
            indexed = {p["name"]: p for p in detect()["projects"]}
            self.assertEqual(set(indexed), {"hal_xhsc", "cmsis_6"})
            self.assertEqual(indexed["hal_xhsc"]["revision"], "v1.2")
            self.assertEqual(indexed["hal_xhsc"]["requiredBy"], ["hc32m4"])
            (soc_dir / "CMakeLists.txt").write_text("")
            self.assertNotIn("hal_xhsc", [p["name"] for p in detect()["projects"]])
            (ws / "prj.conf").write_text("CONFIG_ZEPHYR_CMSIS_MODULE=y\n")
            self.assertEqual([p["name"] for p in detect()["projects"]], names)

    def test_dependency_layouts_are_equivalent(self):
        with tempfile.TemporaryDirectory() as temp:
            ws = Path(temp)
            app = ws / "app"
            board = app / "boards/vendor/demo"
            soc = app / "soc/vendor/chip"
            board.mkdir(parents=True)
            soc.mkdir(parents=True)
            (board / "board.yml").write_text("board: {name: demo, socs: [{name: chip}]}")
            (soc / "soc.yml").write_text("socs: [{name: chip}]")
            modules = ["core", "hal", "device", "support", "skip"]
            (app / "west.yml").write_text(yaml.safe_dump({"manifest": {"projects": [
                {"name": n, "url": "https://example.org/" + n} for n in modules]}}))
            run(ws, sys.executable, "-m", "west", "init", "-l", str(app))
            for name in ("core", "skip"):
                (app / "modules" / name).mkdir(parents=True)
            compact = {
                "prj.conf": "CONFIG_DRIVER=y\nCONFIG_INACTIVE=n\n",
                "modules/core/Kconfig": "config CORE_FEATURE\n    bool\n",
                "modules/skip/Kconfig": "config OPTIONAL_FEATURE\n    bool\n",
                "soc/vendor/chip/Kconfig": "config SOC_CHIP\n    select CORE_FEATURE\n",
                "CMakeLists.txt": "if(CONFIG_DRIVER)\nset(D ${ZEPHYR_HAL_MODULE_DIR})\nendif()\n",
                "sample.yaml": "tests: {demo: {modules: [device, support]}}\n",
            }
            spaced = {
                "prj.conf": "\tCONFIG_DRIVER  =\t y \n\nCONFIG_INACTIVE=n\n",
                "modules/core/Kconfig": "   menuconfig \t CORE_FEATURE  # provider\n\tbool\n",
                "soc/vendor/chip/Kconfig": "  config \t SOC_CHIP  # board\n\n# note\n\tselect \\\n"
                    "\t  CORE_FEATURE # required\n\tselect OPTIONAL_FEATURE if INACTIVE\n"
                    "\thelp\n\t  select OPTIONAL_FEATURE\nconfig OTHER\n\tselect OPTIONAL_FEATURE\n",
                "CMakeLists.txt": "if(  # enabled\n\tCONFIG_DRIVER \n)\n"
                    "  zephyr_include_directories_ifdef( \n\tCONFIG_DRIVER\n"
                    "   \"dir#(x)/${ZEPHYR_HAL_MODULE_DIR}\" \n )\nendif()\n"
                    "zephyr_include_directories_ifdef(\n CONFIG_INACTIVE\n ${ZEPHYR_SKIP_MODULE_DIR})\n"
                    "#[=[ ignored (\nset(X ${ZEPHYR_SKIP_MODULE_DIR})\n]=]\n"
                    "set(LITERAL [==[\n${ZEPHYR_SKIP_MODULE_DIR}\n]==])\n"
                    "if(\n CONFIG_INACTIVE\n)\nset(X ${ZEPHYR_SKIP_MODULE_DIR})\nendif()\n",
                "sample.yaml": "tests:\n  demo:\n    modules:\n      - device\n      - support\n",
            }
            reports = []
            for layout, eol in [(compact, "\n"), ({**compact, **spaced}, "\n"), ({**compact, **spaced}, "\r\n")]:
                for name, content in layout.items():
                    (app / name).write_bytes(content.replace("\n", eol).encode("utf-8"))
                report = json.loads(run(ws, sys.executable, str(HELPER), "dependencies",
                                        data={"application": str(app), "board": "demo"}).stdout)
                self.assertEqual([p["name"] for p in report["projects"]], sorted(modules[:-1]))
                reports.append(report)
            self.assertEqual(reports[0], reports[1])
            self.assertEqual(reports[0], reports[2])

    def test_selects_only_named_repositories_including_project_imports(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            selected = repository(root, "hal_example", {"VERSION": "1"})
            unused = repository(root, "hal_unused", {"VERSION": "2"})
            provider = repository(root, "provider", {"west.yml": yaml.safe_dump(
                {"manifest": {"projects": [selected, unused]}})})
            provider["import"] = True
            workspace = root / "workspace"
            manifest = workspace / "manifest"
            manifest.mkdir(parents=True)
            (manifest / "west.yml").write_text(yaml.safe_dump({"manifest": {"projects": [provider]}}))
            run(workspace, sys.executable, "-m", "west", "init", "-l", str(manifest))
            config = workspace / ".west" / "config"
            original = config.read_bytes()

            def helper(*args, check=True):
                result = run(workspace, sys.executable, str(HELPER), *args, check=False)
                if check:
                    self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                return result
            self.assertTrue(json.loads(helper("list").stdout)["partial"])
            self.assertNotEqual(helper("update", check=False).returncode, 0)
            self.assertFalse((workspace / "provider").exists())
            helper("update", "--", "provider")
            self.assertFalse((workspace / "hal_example").exists())
            catalog = json.loads(helper("list").stdout)
            self.assertFalse(catalog["partial"])
            self.assertEqual({p["name"] for p in catalog["projects"] if p["imported"]}, {"hal_example", "hal_unused"})
            helper("update", "--narrow", "--", "hal_example")
            self.assertEqual(run(workspace / "hal_example", "git", "rev-parse", "HEAD").stdout.strip(), selected["revision"])
            self.assertFalse((workspace / "hal_unused").exists())
            self.assertEqual(config.read_bytes(), original)

    def test_add_and_remove_an_extra_preserve_block_manifest(self):
        source = "# keep\r\nmanifest:\r\n  projects:\r\n    - name: original\r\n      url: https://example.org/git\r\n"
        extra = {"name": "hal_vendor", "path": "modules/hal/vendor", "revision": "v1",
                 "url": "https://github.com/example/hal_vendor.git", "userdata": {"zephyr-ide-additional": True}}
        def edit(source, project, remove=False, check=True):
            return run(HELPER.parent, sys.executable, str(HELPER), "edit",
                       data={"source": source, "project": project, "remove": remove}, check=check)
        added = json.loads(edit(source, extra).stdout)
        self.assertEqual(yaml.safe_load(added)["manifest"]["projects"][0], extra)
        self.assertEqual(json.loads(edit(added, extra, True).stdout), source)
        self.assertNotEqual(edit(added, {"name": "original"}, True, check=False).returncode, 0)

    def test_batch_and_imported_module_edits(self):
        with tempfile.TemporaryDirectory() as temp:
            workspace = Path(temp)
            repo = workspace / "manifest"
            repo.mkdir()
            root = repo / "west.yml"
            source = "manifest:\n  self:\n    import: vendor.yml\n"
            root.write_text(source, encoding="utf-8", newline="")
            vendor = {"name": "vendor", "url": "https://example.org/vendor.git", "groups": ["hal"]}
            (repo / "vendor.yml").write_text(yaml.safe_dump({"manifest": {"projects": [vendor]}}))
            run(workspace, sys.executable, "-m", "west", "init", "-l", str(repo))

            def call(action, **payload):
                return json.loads(run(workspace, sys.executable, str(HELPER), action, data=payload).stdout)

            extras = [{"name": name, "url": "https://example.org/" + name, "userdata": {"zephyr-ide-additional": True}}
                      for name in ("hal_first", "hal_second")]
            batch = call("edit", source=source, entries=extras)
            self.assertFalse(batch["wrapper"])
            self.assertEqual(yaml.safe_load(batch["content"])["manifest"]["projects"], extras)

            edited = call("edit", source=source, previous="vendor", entries=[{**vendor, "revision": "v2"}])
            self.assertTrue(edited["wrapper"])
            call("activate-overlay", file=str(root), source=source, content=edited["content"])
            self.assertEqual(root.read_bytes().decode(), source)
            self.assertEqual(call("list")["projects"][0]["revision"], "v2")
            self.assertEqual(yaml.safe_load(edited["content"])["manifest"]["projects"][0]["groups"], ["hal"])
            deleted = call("edit", source=edited["content"], previous="vendor", entries=[])
            active = next(repo.glob("west-zephyr-ide-*.yml"))
            active.write_text(deleted["content"], encoding="utf-8")
            self.assertEqual(call("list")["projects"], [])


if __name__ == "__main__":
    unittest.main()
