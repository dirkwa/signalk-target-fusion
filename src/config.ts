import { Type, type Static } from 'typebox'

export const ConfigSchema = Type.Object({
  gateDistance: Type.Number({
    title: 'Match targets within (m)',
    description:
      'How far apart a radar or camera target and an AIS position may be and still be linked near own ship. The distance grows by 5% of the range further out, because radar bearing error grows with range.',
    minimum: 10,
    default: 200
  }),
  interval: Type.Number({ title: 'Link targets every (s)', minimum: 1, default: 2 })
})

export type Config = Static<typeof ConfigSchema>

// The server only uses schema defaults to seed the admin form; start()
// receives `{}` for a plugin that has never been configured.
export const DEFAULTS: Config = {
  gateDistance: 200,
  interval: 2
}
