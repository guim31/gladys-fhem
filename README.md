# gladys-fhem

[Gladys Assistant](https://gladysassistant.com) external integration that
bridges **FHEM**: the devices of a FHEM server become Gladys devices, their
readings follow FHEM live, and Gladys controls them through FHEM, which keeps
talking to the hardware (HomeMatic, Z-Wave, Shelly, EnOcean…). Local only. Not
affiliated with the FHEM project.

> Developed without the hardware: tested against a real FHEM 6.4 in Docker with
> dummy devices. Feedback from real installations is welcome.

## What it does

- **Discovery**: one Gladys device per FHEM device, named after its `alias` and
  room, filtered by room and by name. Devices with `genericDeviceType ignore`
  or the `ignore` attribute are left out.
- **Kinds**: from the `genericDeviceType` attribute (the one of the FHEM voice
  assistant modules) when set, else from the commands (`PossibleSets`) and
  readings: lights (on/off, brightness), switches and plugs (on/off, power,
  energy), blinds (position, open/close/stop), thermostat setpoints, contacts,
  motion and presence detectors, locks, and sensors (temperature, humidity,
  pressure, CO2, illuminance, battery).
- **Commands** only when FHEM lists them for the device: `set <device> on`,
  `pct 40`, `desired-temp 21.5`…; the reading change is the feedback.
- **Live states** through the `inform` stream of FHEMWEB, reopened every
  15 minutes (FHEMWEB says nothing on a quiet stream), and polling every 30 s
  when it does not get through (reverse proxy).
- **Safety**: locks, garage doors and alarms are read-only unless allowed; a
  scene cannot get around it. The scene action only runs a `set`: no `;`, no
  Perl.
- **Scene trigger** "FHEM device changed" for the watched devices, **scene
  action** "send a command to a FHEM device", a **dashboard widget** with the
  connection, the stream state and a reload button, and a **connection test**
  listing what was not imported.
- Four languages (English, French, German, Spanish).

## Requirements

- Gladys Assistant 5.1.0 or later.
- FHEM with FHEMWEB (port 8083 by default) reachable from the Gladys machine;
  a user name and password if FHEMWEB asks for one (`allowed` with
  `basicAuth`).

## Installation

In Gladys: **Integrations → Install from GitHub**, address
`https://github.com/guim31/gladys-fhem`. Then follow the
[documentation](docs/en.md).

## How it works

- `GET /fhem?XHR=1` gives the CSRF token (`X-FHEM-csrfToken` header): every
  command needs it, reads included (400 without it). It changes when FHEM
  restarts: a 400 makes the client read it again and try once more.
- `cmd=jsonlist2` builds the inventory (`src/inventory.js`, `src/mapping.js`):
  `Internals` (`TYPE`, `FUUID`), `Readings`, `Attributes` (`room`, `alias`,
  `genericDeviceType`) and `PossibleSets`.
- `inform=type=status;filter=.*;since=null;fmt=JSON` carries the changes, one
  JSON array per line (`["Device-reading","value","html"]`); `global-DEFINED`,
  `-DELETED`, `-RENAMED` and attribute changes (`Device-a-room`) make the
  bridge read the list again (debounced).
- Commands are `cmd=set <device> <args>`: an empty answer is a success, a text
  is FHEM's error (200 either way).
- External ids come from the FUUID of the device (kept on a rename), else its
  name: `uuid:<FUUID>` or `device:<name>`, and `<reading>-<role>` for
  features.
- States are sent only for the devices added in Gladys, only when they change
  (12 h heartbeat), within the 300 states per minute of the core.

## Development

```bash
npm install
npm test                                        # node --test, no network
npm run lint && npm run format:check
npx github:GladysAssistant/integration-store .  # store admission checks
```

`test/fixtures/fhem/jsonlist2-6.4.json` is the `jsonlist2` of a real FHEM 6.4
(Docker image `fhem/fhem`) holding dummy devices with `genericDeviceType`,
`readingList` and `setList`; the CSRF token is blanked.
`test/helpers/fakeFhem.js` serves it through an injected `fetch`, with the
behaviour observed on the real server; `test/gladys-rules.test.js` checks
every device against the feature table of the Gladys core.

## Releasing

**Actions → Release → Run workflow** (patch / minor / major): bumps the
version in `package.json` and the manifest, rolls `CHANGELOG.md`, tags, builds
the multi-arch image to GHCR and publishes the GitHub Release.

## Credits

- [FHEM](https://fhem.de) (GPL-2.0): FHEMWEB, `jsonlist2`, the `inform`
  stream and the `genericDeviceType` attribute, read as documentation; its
  Docker image [fhem/fhem](https://hub.docker.com/r/fhem/fhem) for the fixtures
  and the tests. The cover uses the FHEM logo from
  [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Fhem_logo.svg)
  (public domain, FHEM Team).
- [guim31/gladys-openhab](https://github.com/guim31/gladys-openhab)
  (Apache-2.0), whose bridge structure is reused, and
  [LM1LC3N7/gladys-homey](https://github.com/LM1LC3N7/gladys-homey)
  (Apache-2.0), the origin of the state publisher (`src/publisher.js`).

## Limits

Colours, thermostat modes, players and other commands are not mapped (the
scene action sends any `set`); units are assumed (W, kWh, °C). Developed
without real hardware. See the [documentation](docs/en.md#limits).

## License

Apache-2.0, see [LICENSE](LICENSE). This project is not affiliated with the
FHEM project.
