import { describe, expect, it } from 'vitest'
import {
  associate,
  type AisVessel,
  type AssociationInput,
  type Observation,
  type SensorTarget
} from '../src/association.js'
import { DEFAULTS } from '../src/config.js'

const NOW = Date.parse('2026-10-05T12:00:00Z')
const OWN = { latitude: 52, longitude: 4 }
/** Metres per degree of latitude, near enough for placing test targets. */
const M_PER_DEG = 111_195
const NORTH = 0
const SOUTH = Math.PI

/** A position `north` metres from own ship. */
const at = (north: number) => ({ latitude: OWN.latitude + north / M_PER_DEG, longitude: 4 })

const obs = (north: number, extra: Partial<Observation> = {}): Observation => ({
  position: at(north),
  courseOverGroundTrue: SOUTH,
  speedOverGround: 5,
  timeMs: NOW,
  ...extra
})

const vesselContext = (mmsi: string) => `vessels.urn:mrn:imo:mmsi:${mmsi}`

const ais = (mmsi: string, observation: Observation): AisVessel => ({
  context: vesselContext(mmsi),
  mmsi,
  observation
})

const target = (
  sensor: string,
  context: string,
  observation: Observation,
  mmsi?: string
): SensorTarget => ({ context, sensor, observation, ...(mmsi && { mmsi }) })

const radar = (id: string, observation: Observation, mmsi?: string) =>
  target('mayara', `targets.radar:${id}`, observation, mmsi)

const camera = (id: string, observation: Observation, mmsi?: string) =>
  target('camera-plugin', `targets.camera:${id}`, observation, mmsi)

const run = (input: Partial<AssociationInput>) =>
  associate({
    ownPosition: OWN,
    aisVessels: [],
    targets: [],
    previous: new Map(),
    vessels: new Set(),
    minGateM: DEFAULTS.gateDistance,
    ...input
  })

/** The objects found: each group's context with its member targets. */
const objects = (links: Map<string, string>) => {
  const result: Record<string, string[]> = {}
  for (const [member, group] of links) {
    ;(result[group] ??= []).push(member)
  }
  return result
}

describe('associate', () => {
  it('links a radar target to the AIS vessel it sits on', () => {
    const links = run({
      aisVessels: [ais('244060000', obs(2000))],
      targets: [radar('r0-1', obs(2050))]
    })
    expect(links.get('targets.radar:r0-1')).toBe(vesselContext('244060000'))
  })

  it('keeps a distant radar target as its own object', () => {
    const links = run({
      aisVessels: [ais('244060000', obs(2000))],
      targets: [radar('r0-1', obs(4000))]
    })
    expect(links.get('targets.radar:r0-1')).toBe('targets.radar:r0-1')
  })

  it('does not link targets going different ways', () => {
    const links = run({
      aisVessels: [ais('244060000', obs(2000))],
      targets: [radar('r0-1', obs(2050, { courseOverGroundTrue: NORTH }))]
    })
    expect(links.get('targets.radar:r0-1')).toBe('targets.radar:r0-1')
  })

  it('does not link targets at very different speeds', () => {
    const links = run({
      aisVessels: [ais('244060000', obs(2000))],
      targets: [radar('r0-1', obs(2050, { speedOverGround: 0.2 }))]
    })
    expect(links.get('targets.radar:r0-1')).toBe('targets.radar:r0-1')
  })

  it('compares AIS where it has moved to since its last report', () => {
    const minuteOld = obs(2300, { timeMs: NOW - 60_000 })
    const links = run({
      aisVessels: [ais('244060000', minuteOld)],
      targets: [radar('r0-1', obs(2000))]
    })
    expect(links.get('targets.radar:r0-1')).toBe(vesselContext('244060000'))
  })

  it('links by MMSI whatever the geometry says', () => {
    const links = run({
      aisVessels: [ais('244060000', obs(2000)), ais('244070000', obs(3000))],
      targets: [radar('r0-1', obs(3000), '244060000')]
    })
    expect(links.get('targets.radar:r0-1')).toBe(vesselContext('244060000'))
  })

  it('keeps targets identified as different vessels apart without AIS', () => {
    const links = run({
      targets: [radar('r0-1', obs(1500), '244070000'), camera('7', obs(1520), '244080000')]
    })
    expect(Object.keys(objects(links))).toHaveLength(2)
  })

  it('lets one radar claim an AIS vessel only once, closest first', () => {
    const links = run({
      aisVessels: [ais('244060000', obs(2000))],
      targets: [radar('r0-far', obs(2150)), radar('r0-near', obs(2020))]
    })
    expect(objects(links)).toEqual({
      [vesselContext('244060000')]: ['targets.radar:r0-near'],
      'targets.radar:r0-far': ['targets.radar:r0-far']
    })
  })

  it('groups radar and camera targets of a boat without AIS', () => {
    const links = run({ targets: [radar('r0-1', obs(1500)), camera('7', obs(1530))] })
    expect(objects(links)).toEqual({
      'targets.radar:r0-1': ['targets.radar:r0-1', 'targets.camera:7']
    })
  })

  it('keeps a link a little beyond the distance it took to make it', () => {
    const vessel = [ais('244060000', obs(2000))]
    const drifted = [radar('r0-1', obs(2250))]
    expect(run({ aisVessels: vessel, targets: drifted }).get('targets.radar:r0-1')).toBe(
      'targets.radar:r0-1'
    )

    const previous = run({ aisVessels: vessel, targets: [radar('r0-1', obs(2050))] })
    const links = run({ aisVessels: vessel, targets: drifted, previous })
    expect(links.get('targets.radar:r0-1')).toBe(vesselContext('244060000'))
  })

  it('keeps naming a dark object by the target that named it', () => {
    const previous = run({ targets: [radar('r0-1', obs(1500))] })
    const links = run({
      targets: [camera('7', obs(1510)), radar('r0-1', obs(1500))],
      previous
    })
    expect(objects(links)).toEqual({
      'targets.radar:r0-1': ['targets.radar:r0-1', 'targets.camera:7']
    })
  })

  it('keeps the vessel when its AIS falls silent and radar still tracks it', () => {
    const vessels = new Set([vesselContext('244060000')])
    const previous = run({
      aisVessels: [ais('244060000', obs(2000))],
      targets: [radar('r0-1', obs(2020))],
      vessels
    })
    const links = run({ targets: [radar('r0-1', obs(2020))], previous, vessels })
    expect(links.get('targets.radar:r0-1')).toBe(vesselContext('244060000'))

    const pruned = run({ targets: [radar('r0-1', obs(2020))], previous })
    expect(pruned.get('targets.radar:r0-1')).toBe('targets.radar:r0-1')
  })
})
