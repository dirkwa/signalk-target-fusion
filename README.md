# Signal K Target Fusion

AIS, radar and cameras often see the same boat. This plugin works out which radar and camera targets are a boat AIS already reports, or are the same boat seen by two sensors, and says so in the data model. Collision alarms and chart plotters that follow these links show and alarm each boat once.

![A radar target and the AIS vessel it sees drawn as one boat](docs/screenshots/fused-target.png)

## Setup

Install **Target Fusion** from the App Store. It enables itself, and there is nothing else to set up: it starts linking as soon as a sensor plugin publishes targets. You need:

- a sensor plugin that publishes its targets as `targets.<type>:<id>`, such as the MaYaRa radar plugin (1.7.0 or later) for ARPA targets, and
- AIS, from any connection that brings AIS vessels into Signal K.

The links are only useful to software that follows them. The Collision Alerts plugin raises one alarm per boat instead of one per sensor, and a chart plotter that shows sensor targets (Freeboard-SK, from the release that adds them) draws a linked target as part of its AIS vessel.

## How it works

Radar and camera plugins publish what they track as `targets.<type>:<id>` contexts (see the server's _Sensor targets_ plugin documentation). Every two seconds (configurable) this plugin compares them with the AIS vessels and sets `sameAs` on each target that is the same object as another context:

```
targets.radar:nav1034A-17  sameAs  "vessels.urn:mrn:imo:mmsi:244060000"
```

A target is linked to an AIS vessel when:

- the sensor identified the vessel by its MMSI, or
- the AIS position, moved forward to the time of the radar or camera observation, is close enough to the target, and the two agree on motion: speed within half the faster of the two (never tighter than 1.5 m/s), and course within 45° once both make 1 m/s. Motion is not compared when either side reports no speed.

How close is close enough depends on the boat: 30 m for GPS and sensor position error, plus half the boat's length (AIS reports the antenna, a sensor sees the hull; 50 m is assumed when the vessel reports no length), plus the distance it covers in 10 s (positions are not all taken at the same moment), plus 5% of its range from own ship (radar bearings are less precise far out). A 12 m yacht at anchor 300 m away matches within about 50 m, so a boat without AIS anchored 100 m from it stays a boat of its own; a 300 m tanker at 15 kn 2 km away matches within about 360 m.

Targets without AIS are linked to each other the same way, so a radar track and a camera detection of one boat without AIS are one object. One sensor never contributes two targets to one boat. A link, once made, holds a little beyond the distance and motion limits it took to make it (1.5 times each), so a boat near the limit doesn't flicker between one symbol and two. A target keeps its AIS vessel while radar still tracks it after the vessel's AIS falls silent.

AIS vessels not heard from for ten minutes, and targets their sensor has not updated for a minute, are left out. A target whose track is lost (its sensor publishes a null position) loses its link.

Run one fusion plugin at a time; two would publish conflicting links. Stopping this plugin withdraws the links it made.

## Settings

- **Link targets every (s)**, default 2.

## License

Apache-2.0
