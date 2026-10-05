# Signal K Target Fusion

AIS, radar and cameras often see the same boat. This plugin works out which radar and camera targets are a boat AIS already reports, or are the same boat seen by two sensors, and says so in the data model. Collision alarms and chart plotters that follow these links show and alarm each boat once.

## How it works

Radar and camera plugins publish what they track as `targets.<type>:<id>` contexts (see the server's _Sensor targets_ plugin documentation). Every two seconds (configurable) this plugin compares them with the AIS vessels and sets `sameAs` on each target that is the same object as another context:

```
targets.radar:nav1034A-17  sameAs  "vessels.urn:mrn:imo:mmsi:244060000"
```

A target is linked to an AIS vessel when:

- the sensor identified the vessel by its MMSI, or
- the AIS position, moved forward to the time of the radar or camera observation, is within 200 m of the target (configurable) (more at long range, where radar bearings are less precise), and the two agree on course and speed.

Targets without AIS are linked to each other the same way, so a radar track and a camera detection of one boat without AIS are one object. One sensor never contributes two targets to one boat. A link, once made, holds a little beyond the distance it took to make it, so a boat near the limit doesn't flicker between one symbol and two. A target keeps its AIS vessel while radar still tracks it after the vessel's AIS falls silent.

Run one fusion plugin at a time; two would publish conflicting links. Stopping this plugin withdraws the links it made.

## Settings

- **Match targets within (m)**, default 200: how far apart a target and an AIS position may be near own ship and still be linked. Raise it for a radar or camera with a larger position error, lower it in crowded harbours.
- **Link targets every (s)**, default 2.

## License

Apache-2.0
