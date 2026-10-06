import type { AisVessel, Observation, Position, SensorTarget } from './association.js'

/**
 * AIS vessels whose last position is older than this are not linked to. Class A
 * ships at anchor report every three minutes, so this allows a few misses.
 */
const AIS_MAX_AGE_MS = 10 * 60_000
/** A target its sensor stops updating is left out after this long. */
export const TARGET_MAX_AGE_MS = 60_000
/**
 * Observations stamped further ahead of the clock than this are left out: a
 * future time would keep them fresh until it passed.
 */
const MAX_CLOCK_SKEW_MS = 60_000
/** Motion reported further than this from its position is left out. */
const MOTION_MAX_LAG_MS = 60_000

const MMSI_URN = /^urn:mrn:imo:mmsi:(\d+)$/

interface Leaf {
  value?: unknown
  timestamp?: string
  $source?: string
}

/** The slice of a vessel or target context in the full data model read here. */
export interface ContextNode {
  mmsi?: unknown
  sameAs?: Leaf
  navigation?: {
    position?: Leaf
    courseOverGroundTrue?: Leaf
    speedOverGround?: Leaf
  }
}

export type Contexts = Record<string, ContextNode | undefined>

/**
 * Vessels other than self that AIS reports: plugins also publish vessels AIS
 * never saw (buddy boats over the internet, for one), and every AIS station
 * has an MMSI.
 */
export function aisVessels(vessels: Contexts, selfId: string, nowMs: number): AisVessel[] {
  const result: AisVessel[] = []
  for (const [vesselId, vessel] of Object.entries(vessels)) {
    if (vesselId === selfId || vesselId === 'self' || !vessel) {
      continue
    }
    const mmsi = typeof vessel.mmsi === 'string' ? vessel.mmsi : MMSI_URN.exec(vesselId)?.[1]
    const observation = observationOf(vessel, nowMs, AIS_MAX_AGE_MS)
    if (mmsi && observation) {
      result.push({ context: `vessels.${vesselId}`, mmsi, observation })
    }
  }
  return result
}

/** Targets under `targets.*` with a fresh position. */
export function sensorTargets(targets: Contexts, nowMs: number): SensorTarget[] {
  const result: SensorTarget[] = []
  for (const [id, target] of Object.entries(targets)) {
    const observation = target && observationOf(target, nowMs, TARGET_MAX_AGE_MS)
    if (!observation) {
      continue
    }
    result.push({
      context: `targets.${id}`,
      sensor: target.navigation?.position?.$source ?? id.split(':')[0] ?? id,
      ...(typeof target.mmsi === 'string' && { mmsi: target.mmsi }),
      observation
    })
  }
  return result
}

/** The `sameAs` each target currently has in the data model, by context. */
export function currentLinks(targets: Contexts): Map<string, string | null> {
  const links = new Map<string, string | null>()
  for (const [id, target] of Object.entries(targets)) {
    const value = target?.sameAs?.value
    links.set(`targets.${id}`, typeof value === 'string' ? value : null)
  }
  return links
}

/**
 * Whether the target's sensor reported its track lost, with a null position.
 * Such a track never resumes, so its id may later name a different object.
 */
export function isLost(node: ContextNode | undefined): boolean {
  return node?.navigation?.position?.value === null
}

export function positionOf(node: ContextNode | undefined): Position | undefined {
  const value = node?.navigation?.position?.value
  return isPosition(value) ? value : undefined
}

function observationOf(node: ContextNode, nowMs: number, maxAgeMs: number) {
  const nav = node.navigation
  const position = positionOf(node)
  const timeMs = Date.parse(nav?.position?.timestamp ?? '')
  if (!position || !(nowMs - timeMs <= maxAgeMs) || timeMs - nowMs > MAX_CLOCK_SKEW_MS) {
    return undefined
  }
  const observation: Observation = {
    position: { latitude: position.latitude, longitude: position.longitude },
    timeMs
  }
  const course = motionAt(nav?.courseOverGroundTrue, timeMs)
  const speed = motionAt(nav?.speedOverGround, timeMs)
  if (course !== undefined) {
    observation.courseOverGroundTrue = course
  }
  if (speed !== undefined) {
    observation.speedOverGround = speed
  }
  return observation
}

/**
 * A motion value, unless it was reported well apart from the position: the
 * position is dead-reckoned with it, so a course from another time would
 * mislead the gate.
 */
function motionAt(leaf: Leaf | undefined, positionMs: number): number | undefined {
  const timeMs = Date.parse(leaf?.timestamp ?? '')
  const value = leaf?.value
  return Math.abs(positionMs - timeMs) <= MOTION_MAX_LAG_MS &&
    typeof value === 'number' &&
    Number.isFinite(value)
    ? value
    : undefined
}

function isPosition(value: unknown): value is Position {
  const p = value as Partial<Position> | null | undefined
  return (
    typeof p?.latitude === 'number' &&
    typeof p.longitude === 'number' &&
    Math.abs(p.latitude) <= 90 &&
    Math.abs(p.longitude) <= 180
  )
}
