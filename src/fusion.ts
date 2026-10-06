import { associate } from './association.js'
import { aisVessels, currentLinks, positionOf, sensorTargets, type Contexts } from './model.js'

export interface FusionInput {
  vessels: Contexts
  targets: Contexts
  selfId: string
  nowMs: number
}

/** `sameAs` changes to publish, by target context; `null` withdraws a link. */
export type LinkChanges = Map<string, string | null>

/**
 * Links `targets.*` contexts to the context that names the same object, and
 * says which `sameAs` values have to change in the data model.
 */
export class Fusion {
  /** The context each target belonged to last time, for link hysteresis. */
  private previous = new Map<string, string>()
  /** The link this plugin published per target, so stop() withdraws only those. */
  private readonly linked = new Map<string, string>()

  /** @param minGateM gate radius near own ship (m) */
  constructor(private readonly minGateM: number) {}

  update({ vessels, targets, selfId, nowMs }: FusionInput): LinkChanges {
    const groups = associate({
      ownPosition: positionOf(vessels[selfId]),
      aisVessels: aisVessels(vessels, selfId, nowMs),
      targets: sensorTargets(targets, nowMs),
      previous: this.previous,
      vessels: new Set(Object.keys(vessels).map((id) => `vessels.${id}`)),
      minGateM: this.minGateM
    })
    this.previous = groups

    const changes: LinkChanges = new Map()
    for (const [context, current] of currentLinks(targets)) {
      const group = groups.get(context)
      // A target without a fresh position keeps its link: consumers already
      // ignore it, and the link is right again if the track resumes.
      if (group === undefined) {
        continue
      }
      const wanted = group === context ? null : group
      if (wanted !== current) {
        changes.set(context, wanted)
        if (wanted !== null) {
          this.linked.set(context, wanted)
        }
      }
      if (wanted === null) {
        this.linked.delete(context)
      }
    }
    return changes
  }

  /** Withdraws the links this plugin made that nobody has replaced since. */
  stop(targets: Contexts): LinkChanges {
    const current = currentLinks(targets)
    const changes: LinkChanges = new Map()
    for (const [context, published] of this.linked) {
      if (current.get(context) === published) {
        changes.set(context, null)
      }
    }
    this.linked.clear()
    this.previous = new Map()
    return changes
  }
}
