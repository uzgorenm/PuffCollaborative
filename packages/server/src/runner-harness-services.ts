import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Git } from "@opencode-ai/core/git"
import { AppProcess } from "@opencode-ai/core/process"
import { EffectFlock } from "@opencode-ai/core/util/effect-flock"

export const runnerHarnessServices = LayerNode.group([Git.node, AppProcess.node, EffectFlock.node])
