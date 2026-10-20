# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- FHEM bridge: the devices of a FHEM server, read through FHEMWEB, offered in
  the Discovery tab with their alias and room, filtered by room and by name.
- Lights (on/off, brightness), switches and plugs (on/off, power, energy),
  blinds (position, open, close, stop), thermostat setpoints, contacts, motion
  and presence detectors, locks, and sensors (temperature, humidity, pressure,
  CO2, illuminance, battery), recognized from the `genericDeviceType`
  attribute, else from the commands and readings of the device.
- Live states through the FHEMWEB update stream, polling every 30 seconds when
  it does not get through, and unreachable badges when FHEM is down.
- Optional user name and password (FHEMWEB basic authentication); the CSRF
  token of FHEMWEB is handled automatically.
- Locks, garage doors and alarms read-only unless allowed in the
  configuration; option for blinds that count 0 % as open.
- Scene trigger "FHEM device changed" for the watched devices, scene action
  "Send a command to a FHEM device", dashboard widget with the connection and
  a reload button, and a "Test the connection" action.
- English, French, German and Spanish.

[Unreleased]: https://github.com/guim31/gladys-fhem/commits/main
