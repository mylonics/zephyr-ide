/*
Copyright 2025-2026 mylonics 
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

/**
 * Tracks in-progress writes to zephyr-ide.json initiated by the extension
 * itself. This is used by the FileSystemWatcher in extension.ts to
 * distinguish between external edits (which should trigger a reload) and
 * writes made by the extension (which should be ignored).
 *
 * Every code path that writes zephyr-ide.json must call
 * `markZephyrIdeJsonWrite()` immediately before the write so that the
 * subsequent file-change event is suppressed.
 *
 * Implementation note: Node.js / V8 is single-threaded (event loop), so
 * incrementing and decrementing `_pendingWriteCount` is atomic with respect
 * to other JavaScript code. Multiple overlapping extension writes are handled
 * correctly: each `markZephyrIdeJsonWrite()` call increments the counter and
 * schedules an independent decrement, so the guard stays active until all
 * pending write grace-periods have elapsed.
 */

let _pendingWriteCount = 0;

/**
 * Increment the pending-write counter and schedule a decrement after
 * `durationMs` milliseconds. Call this immediately before each write to
 * zephyr-ide.json that originates from the extension.
 */
export function markZephyrIdeJsonWrite(durationMs = 1000): void {
  _pendingWriteCount++;
  setTimeout(() => {
    if (_pendingWriteCount > 0) {
      _pendingWriteCount--;
    }
  }, durationMs);
}

/**
 * Returns `true` while a write by the extension is still pending (i.e., the
 * file-change event has not yet been emitted or the grace period has not
 * elapsed).  The FileSystemWatcher should skip reloads when this is `true`.
 */
export function isZephyrIdeJsonBeingWrittenByExtension(): boolean {
  return _pendingWriteCount > 0;
}
