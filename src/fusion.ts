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
  /** Targets this plugin linked, so stop() can withdraw exactly those. */
  private readonly linked = new Set<string>()

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
      }
      if (wanted === null) {
        this.linked.delete(context)
      } else {
        this.linked.add(context)
      }
    }
    return changes
  }

  /** Withdraws every link this plugin made. */
  stop(): LinkChanges {
    const changes: LinkChanges = new Map([...this.linked].map((context) => [context, null]))
    this.linked.clear()
    this.previous = new Map()
    return changes
  }
}
