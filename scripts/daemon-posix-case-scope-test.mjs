import assert from "node:assert/strict"
import test from "node:test"
import { mkdtemp, mkdir, readFile, rm, stat } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { acquireDaemonController } from "../src/source/opencode2/daemon-controller.js"

// Case-sensitive POSIX filesystems permit distinct project directories that
// differ only by casing. This is a pure temporary-directory/no-inference test.
test("Linux case-distinct projects do not share native daemon state or locks",
  { skip: process.platform !== "linux" }, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "loop-posix-scope-case-"))
    const upper = path.join(root, "Project")
    const lower = path.join(root, "project")
    let a, b
    try {
      await mkdir(upper)
      await mkdir(lower)
      a = await acquireDaemonController(upper)
      b = await acquireDaemonController(lower)
      // No Goal pulse work and no autonomous inference: suspend checks first.
      assert.match(await a.handle("pulse off"), /Goal pulse: off/)
      assert.match(await a.handle("auto on"), /Daemon: running[\s\S]*Autostart: on/)
      assert.match(await b.handle("status"), /Daemon: stopped[\s\S]*Autostart: off/,
        "distinct lowercase project accidentally shares the upper project's daemon")
      await b.handle("pulse off")
      assert.match(await b.handle("auto on"), /Daemon: running[\s\S]*Autostart: on/)
      for (const directory of [upper, lower]) {
        const file = path.join(directory, ".opencode", "opencode-loop", "daemon-control.json")
        const data = JSON.parse(await readFile(file, "utf8"))
        assert.equal(data.autoStart, true)
        assert.equal(data.pulse, false)
        assert.equal((await stat(path.join(directory, ".opencode", "opencode-loop", "daemon-control.lock"))).isDirectory(), true)
      }
      await a.handle("stop")
      assert.match(await b.handle("status"), /Daemon: running/,
        "stopping one project must not stop the other")
      await b.handle("stop")
      console.log("LOOP_POSIX_CASE_DISTINCT_DAEMON_ISOLATION_NO_INFERENCE_PASS")
    } finally {
      await Promise.all([a?.release(), b?.release()].filter(Boolean))
      await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    }
  })
