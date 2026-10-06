import { describe, expect, it } from 'vitest'
import { DEFAULTS } from '../src/config.js'
import { Fusion } from '../src/fusion.js'
import type { ContextNode, Contexts } from '../src/model.js'

const NOW = Date.parse('2026-10-05T12:00:00Z')
const SELF = 'urn:mrn:signalk:uuid:self'
const VESSEL = 'urn:mrn:imo:mmsi:244060000'
const M_PER_DEG = 111_195

const node = (
  north: number,
  {
    ageMs = 0,
    source = 'mayara',
    sameAs
  }: { ageMs?: number; source?: string; sameAs?: string } = {}
): ContextNode => {
  const timestamp = new Date(NOW - ageMs).toISOString()
  return {
    ...(sameAs !== undefined && { sameAs: { value: sameAs } }),
    navigation: {
      position: {
        value: { latitude: 52 + north / M_PER_DEG, longitude: 4 },
        timestamp,
        $source: source
      },
      courseOverGroundTrue: { value: Math.PI, timestamp },
      speedOverGround: { value: 5, timestamp }
    }
  }
}

const vessels = (extra: Contexts = {}): Contexts => ({
  [SELF]: node(0),
  [VESSEL]: node(2000),
  ...extra
})

const update = (fusion: Fusion, targets: Contexts, v: Contexts = vessels()) =>
  fusion.update({ vessels: v, targets, selfId: SELF, nowMs: NOW })

describe('Fusion', () => {
  it('links a target to the AIS vessel it sits on', () => {
    const changes = update(new Fusion(DEFAULTS.gateDistance), { 'radar:r0-1': node(2050) })
    expect([...changes]).toEqual([['targets.radar:r0-1', `vessels.${VESSEL}`]])
  })

  it('publishes nothing when the data model already has the link', () => {
    const changes = update(new Fusion(DEFAULTS.gateDistance), {
      'radar:r0-1': node(2050, { sameAs: `vessels.${VESSEL}` })
    })
    expect(changes.size).toBe(0)
  })

  it('withdraws a link that no longer holds', () => {
    const changes = update(new Fusion(DEFAULTS.gateDistance), {
      'radar:r0-1': node(5000, { sameAs: `vessels.${VESSEL}` })
    })
    expect([...changes]).toEqual([['targets.radar:r0-1', null]])
  })

  it('does not link to a vessel without an MMSI', () => {
    const buddy = 'urn:mrn:signalk:uuid:c0d79334-4e25-4245-8892-54e8ccc8021d'
    const changes = update(
      new Fusion(DEFAULTS.gateDistance),
      { 'radar:r0-1': node(4050) },
      vessels({ [buddy]: node(4000) })
    )
    expect(changes.size).toBe(0)
  })

  it('leaves a stale target and its link alone', () => {
    const changes = update(new Fusion(DEFAULTS.gateDistance), {
      'radar:r0-1': node(5000, { ageMs: 2 * 60_000, sameAs: `vessels.${VESSEL}` })
    })
    expect(changes.size).toBe(0)
  })

  it('links one target per sensor to a vessel', () => {
    const changes = update(new Fusion(DEFAULTS.gateDistance), {
      'radar:r0-1': node(2020),
      'radar:r0-2': node(2060),
      'camera:7': node(2040, { source: 'camera-plugin' })
    })
    expect(Object.fromEntries(changes)).toEqual({
      'targets.radar:r0-1': `vessels.${VESSEL}`,
      'targets.camera:7': `vessels.${VESSEL}`
    })
  })

  it('withdraws its links when stopped', () => {
    const fusion = new Fusion(DEFAULTS.gateDistance)
    update(fusion, { 'radar:r0-1': node(2050) })
    const linked = { 'radar:r0-1': node(2050, { sameAs: `vessels.${VESSEL}` }) }
    expect([...fusion.stop(linked)]).toEqual([['targets.radar:r0-1', null]])
  })

  it('leaves a link it did not publish in place when stopped', () => {
    const fusion = new Fusion(DEFAULTS.gateDistance)
    const targets = { 'radar:r0-1': node(2050, { sameAs: `vessels.${VESSEL}` }) }
    update(fusion, targets)
    expect(fusion.stop(targets).size).toBe(0)
  })

  it('leaves a link another writer replaced in place when stopped', () => {
    const fusion = new Fusion(DEFAULTS.gateDistance)
    update(fusion, { 'radar:r0-1': node(2050) })
    const replaced = { 'radar:r0-1': node(2050, { sameAs: 'targets.camera:7' }) }
    expect(fusion.stop(replaced).size).toBe(0)
  })
})
