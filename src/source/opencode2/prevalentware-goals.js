import { promises as fs } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"

export function prevalentwareStatePath(env = process.env) {
  if (env.OPENCODE_GOAL_STATE_PATH) return env.OPENCODE_GOAL_STATE_PATH
  const home = env.XDG_DATA_HOME || (process.platform === "win32" && env.APPDATA ? env.APPDATA : path.join(homedir(), ".local", "share"))
  return path.join(home, "opencode-goal-plugin", "goals.json")
}

// The third-party Goal plugin stores ALL workspaces in one file. Never inspect
// or report a Goal until OpenCode has attested that its session belongs to this
// plugin's current project. A missing or failing attestation denies access.
export async function readScopedPrevalentwareGoals({ scopeAllowed, statePath = prevalentwareStatePath() } = {}) {
  if (typeof scopeAllowed !== "function") return []
  let state
  try { state = JSON.parse(await fs.readFile(statePath, "utf8")) }
  catch (error) { if (error.code === "ENOENT") return []; throw error }
  if (!state || ![1, 2, 3].includes(state.version) || !state.goals || typeof state.goals !== "object" || Array.isArray(state.goals)) {
    throw new Error("Invalid third-party Goal state; refusing monitoring")
  }
  const accepted = []
  for (const [key, goal] of Object.entries(state.goals)) {
    if (!goal || typeof goal !== "object" || typeof goal.sessionID !== "string" || goal.sessionID !== key) continue
    let allowed = false
    try { allowed = await scopeAllowed(goal.sessionID) === true } catch { allowed = false }
    if (!allowed || typeof goal.id !== "string" || !Number.isFinite(goal.updatedAt) || goal.updatedAt <= 0) continue
    // prevalentware v0.1.63 persists Unix SECONDS; Loop pulse state uses milliseconds.
    const updatedAt = goal.updatedAt < 100_000_000_000 ? goal.updatedAt * 1000 : goal.updatedAt
    accepted.push({
      id: `prevalentware:${goal.id}`,
      sessionID: goal.sessionID,
      status: goal.status,
      updatedAt,
      progressRevision: Number(goal.planRevision || 0),
      revision: Number(goal.autoTurns || 0),
      storageGeneration: 0,
    })
  }
  return accepted
}