/**
 * Decides which targets are the same object.
 *
 * AIS vessels anchor the picture because they carry identity. A radar or
 * camera target joins an AIS vessel when it says so through its MMSI, or when
 * the AIS position, extrapolated to the target's time, lies within a distance
 * gate and the two agree on course and speed. Targets no AIS vessel claims are
 * grouped with each other the same way, so a radar track and a camera
 * detection of one dark boat are still one object.
 *
 * A link, once made, is kept with a wider gate than it took to make it, so a
 * target near the threshold does not split and merge on every evaluation.
 */

export interface Position {
  latitude: number
  longitude: number
}

export interface Observation {
  position: Position
  courseOverGroundTrue?: number
  speedOverGround?: number
  timeMs: number
}

export interface AisVessel {
  /** Vessel context, e.g. `vessels.urn:mrn:imo:mmsi:244060000`. */
  context: string
  mmsi: string
  observation: Observation
}

export interface SensorTarget {
  /** Target context, e.g. `targets.radar:nav1034A-17`. */
  context: string
  /** What reported it, so one sensor never contributes two targets to one object. */
  sensor: string
  /** MMSI when the sensor itself identified the vessel. */
  mmsi?: string
  observation: Observation
}

export interface AssociationInput {
  ownPosition?: Position
  aisVessels: AisVessel[]
  targets: SensorTarget[]
  /** The context each target belonged to last time, by target context. */
  previous: ReadonlyMap<string, string>
  /**
   * Vessel contexts still in the data model, so a target keeps the vessel it
   * was linked to after that vessel's AIS falls silent.
   */
  vessels: ReadonlySet<string>
  /** Gate radius near own ship (m), covering GPS, antenna offset and timing errors. */
  minGateM: number
}

/**
 * Radar bearing error grows with range (1° is 17 m per km), so the gate widens
 * with the target's distance from own ship.
 */
const GATE_RANGE_FRACTION = 0.05
/** An existing link survives until the gap exceeds this multiple of the gate. */
const KEEP_GATE_FACTOR = 1.5
/** Below this speed a course is noise and is not compared. */
const COURSE_MIN_SPEED = 1
const MAX_COURSE_DIFF = Math.PI / 4
const MIN_SPEED_TOLERANCE = 1.5
const SPEED_TOLERANCE_FRACTION = 0.5

const EARTH_RADIUS_M = 6371000

interface Group {
  /** The context that names the object: the AIS vessel, or one of its targets. */
  context: string
  ais?: AisVessel
  /** The observation new members are gated against. */
  reference: Observation
  members: SensorTarget[]
  sensors: Set<string>
}

interface Candidate {
  target: SensorTarget
  group: Group
  cost: number
}

/**
 * The context each target belongs to, by target context. A target that names
 * its own group maps to its own context.
 */
export function associate(input: AssociationInput): Map<string, string> {
  const groups: Group[] = input.aisVessels.map((ais) => ({
    context: ais.context,
    ais,
    reference: ais.observation,
    members: [],
    sensors: new Set()
  }))

  const unassigned = assignGreedily(input.targets, groups, input)

  // Targets that named their group last time seed first, so an object keeps
  // its context while the target that named it is still tracked.
  const taken = new Set(groups.map((g) => g.context))
  const remaining = [...unassigned].sort(
    (a, b) => Number(isSeed(b, input)) - Number(isSeed(a, input))
  )
  const darkGroups: Group[] = []
  for (const target of remaining) {
    if (assignGreedily([target], darkGroups, input).length > 0) {
      const context = seedContext(target, input, taken)
      taken.add(context)
      darkGroups.push({
        context,
        reference: target.observation,
        members: [target],
        sensors: new Set([target.sensor])
      })
    }
  }

  const links = new Map<string, string>()
  for (const group of [...groups, ...darkGroups]) {
    for (const member of group.members) {
      links.set(member.context, group.context)
    }
  }
  return links
}

/** Whether a target named its group last time, itself or as the vessel it kept. */
function isSeed(target: SensorTarget, input: AssociationInput): boolean {
  const previous = input.previous.get(target.context)
  return previous === target.context || (previous !== undefined && input.vessels.has(previous))
}

/**
 * The context a group seeded by this target is named by: the vessel it was
 * linked to while that vessel is still in the data model, otherwise its own.
 */
function seedContext(target: SensorTarget, input: AssociationInput, taken: Set<string>): string {
  const previous = input.previous.get(target.context)
  return previous !== undefined && input.vessels.has(previous) && !taken.has(previous)
    ? previous
    : target.context
}

/**
 * Assigns targets to groups cheapest pair first, at most one target per sensor
 * in each group: one sensor does not see the same boat twice. Returns the
 * targets left over.
 */
function assignGreedily(
  targets: SensorTarget[],
  groups: Group[],
  input: AssociationInput
): SensorTarget[] {
  const candidates: Candidate[] = []
  for (const target of targets) {
    for (const group of groups) {
      const cost = matchCost(target, group, input)
      if (cost !== undefined) {
        candidates.push({ target, group, cost })
      }
    }
  }
  candidates.sort((a, b) => a.cost - b.cost)

  const assigned = new Set<SensorTarget>()
  for (const { target, group } of candidates) {
    if (assigned.has(target) || group.sensors.has(target.sensor)) {
      continue
    }
    group.members.push(target)
    group.sensors.add(target.sensor)
    assigned.add(target)
  }
  return targets.filter((t) => !assigned.has(t))
}

/**
 * How well a target fits a group, lower is better, or `undefined` when it
 * cannot belong to it. A matching MMSI beats any geometric match.
 */
function matchCost(
  target: SensorTarget,
  group: Group,
  input: AssociationInput
): number | undefined {
  // A target the sensor has identified only joins the AIS vessel with that
  // MMSI, never one that merely happens to be nearby, and never a group
  // another sensor identified as a different vessel.
  if (target.mmsi !== undefined) {
    if (group.ais) {
      return target.mmsi === group.ais.mmsi ? -1 : undefined
    }
    const groupMmsi = group.members.find((m) => m.mmsi !== undefined)?.mmsi
    if (groupMmsi !== undefined) {
      return target.mmsi === groupMmsi ? -1 : undefined
    }
  }
  const { observation } = target
  const wasLinked = input.previous.get(target.context) === group.context
  const gate =
    gateRadius(observation.position, input.minGateM, input.ownPosition) *
    (wasLinked ? KEEP_GATE_FACTOR : 1)
  const expected = extrapolate(group.reference, observation.timeMs)
  const gap = distance(expected, observation.position)
  if (gap > gate || !motionAgrees(group.reference, observation, wasLinked)) {
    return undefined
  }
  return gap / gate - (wasLinked ? 1 : 0)
}

function gateRadius(position: Position, minGateM: number, ownPosition?: Position): number {
  if (!ownPosition) {
    return minGateM
  }
  return Math.max(minGateM, distance(position, ownPosition) * GATE_RANGE_FRACTION)
}

function motionAgrees(a: Observation, b: Observation, lenient: boolean): boolean {
  const factor = lenient ? KEEP_GATE_FACTOR : 1
  if (a.speedOverGround !== undefined && b.speedOverGround !== undefined) {
    const tolerance = Math.max(
      MIN_SPEED_TOLERANCE,
      SPEED_TOLERANCE_FRACTION * Math.max(a.speedOverGround, b.speedOverGround)
    )
    if (Math.abs(a.speedOverGround - b.speedOverGround) > tolerance * factor) {
      return false
    }
    if (
      a.courseOverGroundTrue !== undefined &&
      b.courseOverGroundTrue !== undefined &&
      a.speedOverGround >= COURSE_MIN_SPEED &&
      b.speedOverGround >= COURSE_MIN_SPEED &&
      angleBetween(a.courseOverGroundTrue, b.courseOverGroundTrue) > MAX_COURSE_DIFF * factor
    ) {
      return false
    }
  }
  return true
}

/** Dead-reckons an observation to `timeMs` along its course and speed. */
export function extrapolate(o: Observation, timeMs: number): Position {
  if (o.speedOverGround === undefined || o.courseOverGroundTrue === undefined) {
    return o.position
  }
  const run = (o.speedOverGround * (timeMs - o.timeMs)) / 1000
  const dLat = (run * Math.cos(o.courseOverGroundTrue)) / EARTH_RADIUS_M
  const dLon =
    (run * Math.sin(o.courseOverGroundTrue)) /
    (EARTH_RADIUS_M * Math.cos(toRad(o.position.latitude)))
  return {
    latitude: o.position.latitude + toDeg(dLat),
    longitude: normaliseLongitude(o.position.longitude + toDeg(dLon))
  }
}

/** Great-circle distance in metres (haversine). */
export function distance(a: Position, b: Position): number {
  const dLat = toRad(b.latitude - a.latitude)
  const dLon = toRad(b.longitude - a.longitude)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)))
}

function angleBetween(a: number, b: number): number {
  const d = Math.abs(a - b) % (2 * Math.PI)
  return d > Math.PI ? 2 * Math.PI - d : d
}

function normaliseLongitude(lon: number): number {
  return ((((lon + 180) % 360) + 360) % 360) - 180
}

const toRad = (deg: number) => (deg * Math.PI) / 180
const toDeg = (rad: number) => (rad * 180) / Math.PI
