import type { Context, Path, Plugin, ServerAPI } from '@signalk/server-api'
import { ConfigSchema, DEFAULTS, MIN_INTERVAL_S, type Config } from './config.js'
import { Fusion, type LinkChanges } from './fusion.js'
import type { Contexts } from './model.js'

const PLUGIN_ID = 'signalk-target-fusion'

export default function (app: ServerAPI): Plugin {
  let timer: ReturnType<typeof setInterval> | undefined
  let fusion: Fusion | undefined

  function publish(changes: LinkChanges): void {
    for (const [context, value] of changes) {
      app.handleMessage(PLUGIN_ID, {
        context: context as Context,
        updates: [{ values: [{ path: 'sameAs' as Path, value }] }]
      })
    }
  }

  return {
    id: PLUGIN_ID,
    name: 'Target Fusion',
    description: 'Links radar and camera targets to the AIS vessels they see',
    schema: () => ConfigSchema,

    start(partial: object) {
      // The server does not apply schema defaults at runtime.
      const config: Config = { ...DEFAULTS, ...(partial as Partial<Config>) }
      const active = new Fusion(config.gateDistance)
      fusion = active
      timer = setInterval(
        () => {
          // One data-model surprise must not stop linking for good.
          try {
            publish(
              active.update({
                vessels: (app.getPath('vessels') ?? {}) as Contexts,
                targets: (app.getPath('targets') ?? {}) as Contexts,
                selfId: app.selfId,
                nowMs: Date.now()
              })
            )
          } catch (err) {
            app.error(`Target fusion failed: ${String(err)}`)
          }
        },
        Math.max(config.interval, MIN_INTERVAL_S) * 1000
      )
      app.setPluginStatus('Linking targets to AIS vessels')
    },

    stop() {
      clearInterval(timer)
      timer = undefined
      if (fusion) {
        publish(fusion.stop((app.getPath('targets') ?? {}) as Contexts))
      }
      fusion = undefined
    }
  }
}
