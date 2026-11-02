import * as assert from "assert";
import { analyzeWindowsEnvironment, readWindowsEnvironment, WindowsEnvironmentSnapshot } from "../setup_utilities/environment-diagnostics";

suite("Windows Environment Diagnostics", () => {
  function validSnapshot(): WindowsEnvironmentSnapshot {
    return {
      user: { Path: "%LOCALAPPDATA%\\Microsoft\\WindowsApps;C:\\UserTools", TEMP: "%LOCALAPPDATA%\\Temp", CUSTOM: "value" },
      machine: { PATH: "C:\\Windows\\System32", TEMP: "C:\\Windows\\Temp" },
      process: {
        Path: "C:\\Windows\\System32;C:\\Users\\test\\AppData\\Local\\Microsoft\\WindowsApps;C:\\UserTools",
        LOCALAPPDATA: "C:\\Users\\test\\AppData\\Local",
        TEMP: "C:\\Users\\test\\AppData\\Local\\Temp",
        CUSTOM: "value",
      },
    };
  }

  test("Accepts a complete inherited environment without mutating it", () => {
    const snapshot = validSnapshot();
    const original = JSON.stringify(snapshot);
    assert.deepStrictEqual(analyzeWindowsEnvironment(snapshot), []);
    assert.strictEqual(JSON.stringify(snapshot), original);
  });

  test("Detects the missing user PATH and variables after it at sign-in", () => {
    const snapshot = validSnapshot();
    snapshot.process.Path = snapshot.machine.PATH;
    snapshot.process.TEMP = snapshot.machine.TEMP;
    delete snapshot.process.CUSTOM;
    assert.deepStrictEqual(analyzeWindowsEnvironment(snapshot).map(issue => issue.code),
      ["missingVariables", "missingPathEntries", "tempMismatch"]);
  });

  test("Detects duplicate user entries and entries already in system PATH", () => {
    const snapshot = validSnapshot();
    snapshot.user.Path += ';c:/usertools/;"C:\\WINDOWS\\system32\\"';
    assert.deepStrictEqual(analyzeWindowsEnvironment(snapshot).map(issue => issue.code),
      ["duplicatePathEntries", "systemPathEntries"]);
  });

  test("Matches names and paths case-insensitively and ignores empty entries", () => {
    const snapshot = validSnapshot();
    snapshot.user = { path: '; "c:/USERTOOLS/" ;;', temp: "c:/users/TEST/appdata/local/TEMP/", custom: "" };
    assert.deepStrictEqual(analyzeWindowsEnvironment(snapshot), []);
  });

  test("Compares PATH entries, not substrings", () => {
    const snapshot = validSnapshot();
    snapshot.user.Path = "C:\\User";
    assert.deepStrictEqual(analyzeWindowsEnvironment(snapshot).map(issue => issue.code), ["missingPathEntries"]);
  });

  test("Does not confuse a drive-relative PATH entry with the drive root", () => {
    assert.deepStrictEqual(analyzeWindowsEnvironment({
      user: { Path: "C:\\" }, machine: {}, process: { Path: "C:" },
    }).map(issue => issue.code), ["missingPathEntries"]);
  });

  test("Resolves references to user variables absent from the session", () => {
    const snapshot = validSnapshot();
    snapshot.user.TOOLS = "C:\\UserTools";
    snapshot.user.Path = "%TOOLS%";
    assert.deepStrictEqual(analyzeWindowsEnvironment(snapshot).map(issue => issue.code), ["missingVariables"]);
  });

  test("Detects stale PATH expansion even when the referenced variable is present", () => {
    assert.deepStrictEqual(analyzeWindowsEnvironment({
      user: { Path: "%TOOLROOT%\\bin", TOOLROOT: "C:\\New" },
      machine: {},
      process: { Path: "C:\\Old\\bin", TOOLROOT: "C:\\Old" },
    }).map(issue => issue.code), ["missingPathEntries"]);
  });

  test("Handles absent user PATH/TEMP and empty environments", () => {
    assert.deepStrictEqual(analyzeWindowsEnvironment({ user: {}, machine: {}, process: {} }), []);
    assert.deepStrictEqual(analyzeWindowsEnvironment({ user: { OTHER: "" }, machine: {}, process: {} })
      .map(issue => issue.code), ["missingVariables"]);
  });

  test("Flags the Windows PATH length limit and handles cyclic references", () => {
    const longPath = "C:\\" + "a".repeat(32767);
    assert.deepStrictEqual(analyzeWindowsEnvironment({
      user: { Path: longPath }, machine: {}, process: { PATH: longPath },
    }).map(issue => issue.code), ["pathTooLong"]);
    assert.deepStrictEqual(analyzeWindowsEnvironment({
      user: { Path: "%LOOP%", LOOP: "%LOOP%" }, machine: {}, process: { Path: "%LOOP%", LOOP: "%LOOP%" },
    }), []);
  });

  test("Reads the real PowerShell environment on Windows", async function () {
    if (process.platform !== "win32") {
      this.skip();
    }
    const snapshot = await readWindowsEnvironment();
    assert.ok(Object.keys(snapshot.process).length > 0);
    assert.ok(Array.isArray(analyzeWindowsEnvironment(snapshot)));
  });
});
