// -----------------------------------------------------------------------------
// FHEM devices -> Gladys devices and routing tables (pure).
//
// One Gladys device per FHEM device. Its external id comes from the FUUID of
// the device (FHEM 6: kept when a device is renamed), else from its name:
//   device   ext:<selector>:uuid:<FUUID> | ext:<selector>:device:<name>
//   feature  <device id>:<reading>-<role>
// Commands go to the CURRENT name of the device, read again with the list.
//
// Selection (configuration): rooms (the `room` attribute, any of them),
// devices to exclude (name patterns).
// -----------------------------------------------------------------------------

import { matcher } from './config.js';
import { isSecurityDevice, mapDevice, roomsOf, typeOf } from './mapping.js';
import { ROLE_NAMES } from './texts.js';

const cut = (text, max = 100) => String(text ?? '').slice(0, max);

/** FHEM's own plumbing: never listed as "not imported". */
const SILENT_TYPES = new Set([
  'Global',
  'FHEMWEB',
  'telnet',
  'eventTypes',
  'FileLog',
  'DbLog',
  'autocreate',
  'SVG',
  'weblink',
  'notify',
  'at',
  'DOIF',
  'watchdog',
  'allowed',
  'readingsGroup',
  'logProxy',
  'DockerImageInfo',
  'Log',
  'msgConfig',
  'holiday',
]);

/**
 * @param {object[]} list jsonlist2 Results
 * @param {object} options the normalized configuration (src/config.js) + { externalIds }
 */
export function buildInventory(list, options) {
  const { externalIds, language = 'fr' } = options;
  const all = Array.isArray(list) ? list.filter((d) => typeof d?.Name === 'string') : [];
  const excluded = matcher(options.exclude ?? []);
  const rooms = new Set(options.rooms ?? []);
  const roles = ROLE_NAMES[language] ?? ROLE_NAMES.en;

  const devices = [];
  /** device name -> reading -> [{ featureId, read, throttle }] */
  const routes = new Map();
  /** feature external id -> { device, write } */
  const writers = new Map();
  /** feature external id -> device name, read-only features included */
  const featureDevice = new Map();
  /** device name -> Gladys device external id */
  const deviceIds = new Map();
  /** device names whose commands are a security choice */
  const security = new Set();
  const ignored = new Map();

  for (const fhem of all) {
    const name = fhem.Name;
    if (isSecurityDevice(fhem)) {
      security.add(name);
    }
    if (SILENT_TYPES.has(typeOf(fhem)) || excluded(name)) {
      continue;
    }
    const where = roomsOf(fhem);
    if (rooms.size > 0 && !where.some((r) => rooms.has(r.toLowerCase()))) {
      continue;
    }
    const features = mapDevice(fhem, options);
    if (!Array.isArray(features)) {
      ignored.set(features.skipped, (ignored.get(features.skipped) ?? 0) + 1);
      continue;
    }
    const uuid = String(fhem.Internals?.FUUID ?? '').trim();
    const ids = /^[\w-]+$/.test(uuid) ? externalIds('uuid', uuid) : externalIds('device', name);
    const base = String(fhem.Attributes?.alias || name).trim();
    const room = where.find((r) => r.toLowerCase() !== 'hidden') ?? '';
    const label =
      room && !base.toLowerCase().includes(room.toLowerCase()) ? `${base} (${room})` : base;
    const device = {
      name: cut(label),
      external_id: ids.device,
      should_poll: false,
      features: [],
      params: [
        { name: 'fhem_name', value: name },
        { name: 'fhem_type', value: typeOf(fhem) },
        ...(room ? [{ name: 'fhem_room', value: room }] : []),
      ],
    };
    deviceIds.set(name, ids.device);
    const deviceRoutes = new Map();
    for (const f of features) {
      const featureId = ids.feature(`${f.reading}-${f.role}`);
      device.features.push({
        name: cut(roles[f.role] ?? f.role),
        external_id: featureId,
        ...f.spec,
      });
      featureDevice.set(featureId, name);
      if (f.read) {
        const list = deviceRoutes.get(f.reading) ?? [];
        list.push({ featureId, read: f.read, throttle: Boolean(f.throttle) });
        deviceRoutes.set(f.reading, list);
      }
      if (f.write) {
        writers.set(featureId, { device: name, write: f.write });
      }
    }
    routes.set(name, deviceRoutes);
    devices.push(device);
  }

  return {
    devices,
    routes,
    writers,
    featureDevice,
    deviceIds,
    security,
    known: new Set(all.map((d) => d.Name)),
    ignored: [...ignored.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
  };
}
