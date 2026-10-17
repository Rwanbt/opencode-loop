import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import { readScopedPrevalentwareGoals } from "../src/source/opencode2/prevalentware-goals.js"
import { checkGoalPulse } from "./pulse-check.mjs"

test("third-party global Goals require project session attestation", async () => {
  const project = await mkdtemp(path.join(os.tmpdir(), "loop-prevalentware-"))
  const storage = path.join(project, "third-party-goals.json")
  const now = Date.now()
  const state = {
    version: 3,
    goals: {
      ses_allowed: { id: "allowed", sessionID: "ses_allowed", status: "active", updatedAt: Math.floor((now - 60 * 60_000) / 1000), planRevision: 2, autoTurns: 4 },
      ses_foreign: { id: "foreign", sessionID: "ses_foreign", status: "active", updatedAt: now - 60 * 60_000 },
      ses_bad: { id: "mismatch", sessionID: "ses_not_matching_key", status: "active", updatedAt: now - 60 * 60_000 },
    },
  }
  await writeFile(storage, JSON.stringify(state))
  const original = await readFile(storage, "utf8")
  try {
    const allowed = await readScopedPrevalentwareGoals({ statePath: storage, scopeAllowed: async (sessionID) => sessionID === "ses_allowed" })
    assert.equal(allowed.length, 1)
    assert.equal(allowed[0].id, "prevalentware:allowed")
    assert.equal(allowed[0].progressRevision, 2)
    assert.ok(Math.abs(allowed[0].updatedAt - (now - 60 * 60_000)) < 1000, "Unix seconds must become milliseconds")
    assert.deepEqual(await readScopedPrevalentwareGoals({ statePath: storage }), [])
    const first = await checkGoalPulse(project, { staleAfterMs: 10 * 60_000, now, externalGoals: allowed })
    assert.equal(first.checked, 1)
    assert.equal(first.alerts.length, 1)
    assert.match(first.alerts[0].message, /GOAL PULSE STALLED/)
    const second = await checkGoalPulse(project, { staleAfterMs: 10 * 60_000, now: now + 2_000, externalGoals: allowed })
    assert.equal(second.alerts.length, 0, "deduplicated alert")
    assert.equal(await readFile(storage, "utf8"), original, "external Goal state must be read-only")
  } finally { await rm(project, { recursive: true, force: true }) }
})

test("corrupt global Goal state fails closed", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "loop-prevalentware-invalid-"))
  const file = path.join(dir, "invalid.json")
  try {
    await writeFile(file, '{"version":4,"goals":{}}')
    await assert.rejects(readScopedPrevalentwareGoals({ statePath: file, scopeAllowed: async () => true }), /Invalid third-party Goal state/)
  } finally { await rm(dir, { recursive: true, force: true }) }
})