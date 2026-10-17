import { Plugin } from "@opencode/plugin"
import bundled from "./native.js"

const native = Plugin.define({
  id: "@rwanbt/opencode-loop",
  setup: (context) => bundled.setup(context),
})

export const OpenCodeLoopNativePlugin = native
export default native
