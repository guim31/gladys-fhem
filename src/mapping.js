// -----------------------------------------------------------------------------
// One FHEM device -> Gladys features (pure).
//
// A device is an entry of jsonlist2: `Name`, `Internals` (TYPE, FUUID),
// `Readings` ({ name: { Value, Time } }), `Attributes` (room, alias,
// genericDeviceType...) and `PossibleSets` ("on off pct:slider,0,1,100").
// `mapDevice` returns its features, each
//   role      part of the feature external id, with its reading: never change it,
//   reading   the reading it follows,
//   spec      category, type, unit, min, max, read_only, has_feedback,
//   read      (reading value) -> number | null (null: nothing to publish),
//   write     (value) -> the arguments of `set <device>`,
//   throttle  a measurement, spaced by the sensor interval,
// or `{ skipped: reason }` when nothing maps it.
//
// The kind of a device comes from its `genericDeviceType` attribute (the one
// of the FHEM voice assistant modules: switch, outlet, light, blind,
// thermostat, contact, window, motion, lock, garage, security...) when set,
// else from its commands (PossibleSets) and readings. A command is offered
// only when PossibleSets has it. Locks, garage doors and alarms stay
// read-only unless the configuration allows them.
//
// Value conventions: FHEM writes `pct` 100 for an open blind (HomeMatic,
// Shelly, homebridge): a Gladys shutter position too (`invert_blinds` for the
// others). A Gladys opening sensor is 0 when OPEN (OPENING_SENSOR_STATE).
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
  DEVICE_FEATURE_UNITS as U,
} from '@gladysassistant/integration-sdk';

// Value enums of the Gladys core (server/utils/constants.js, copied: the SDK
// does not export them).
export const COVER_STATE = { STOP: 0, OPEN: 1, CLOSE: -1 };
export const OPENING_SENSOR_STATE = { OPEN: 0, CLOSE: 1 };

const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const BIG = 1e9;

/** The error thrown for a refused write, keyed in src/texts.js ERRORS. */
export class WriteError extends Error {
  constructor(key) {
    super(key);
    this.name = 'WriteError';
    this.key = key;
  }
}

// --- Device helpers ---------------------------------------------------------------

export const typeOf = (device) => String(device?.Internals?.TYPE ?? '');
export const genericType = (device) =>
  String(device?.Attributes?.genericDeviceType ?? '')
    .trim()
    .toLowerCase();

/** The current value of a reading, as text; undefined when the device has none. */
export const readingOf = (device, name) => {
  const value = device?.Readings?.[name]?.Value;
  return value === undefined || value === null ? undefined : String(value);
};

/** The rooms of a device ("Living room,Ground floor"), without blanks. */
export const roomsOf = (device) =>
  String(device?.Attributes?.room ?? '')
    .split(',')
    .map((r) => r.trim())
    .filter(Boolean);

/**
 * PossibleSets -> Map(command -> { options: string[] | null, slider: { min, step, max } | null }).
 * "on:noArg off pct:slider,0,1,100 desired-temp:5.0,5.5,30.0 mode:auto,manual"
 */
export function parseSets(text) {
  const sets = new Map();
  for (const word of String(text ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)) {
    const colon = word.indexOf(':');
    const name = colon < 0 ? word : word.slice(0, colon);
    const rest = colon < 0 ? '' : word.slice(colon + 1);
    const parts = rest === '' ? [] : rest.split(',');
    let slider = null;
    let options = null;
    if (parts[0] === 'slider' || parts[0] === 'knob' || parts[0] === 'selectnumbers') {
      const [min, step, max] = parts.slice(1, 4).map(Number);
      if ([min, step, max].every(Number.isFinite) && min <= max) {
        slider = { min, step, max };
      }
    } else if (parts.length > 0 && !['noArg', 'textField', 'textField-long'].includes(parts[0])) {
      options = parts;
    }
    if (name !== '' && !sets.has(name)) {
      sets.set(name, { options, slider });
    }
  }
  return sets;
}

/** "21.5", "21.5 °C", "48 %" -> 21.5 / 48; "off", "" -> null. */
export function parseNumber(text) {
  if (typeof text !== 'string') {
    return null;
  }
  const match = text.trim().match(/^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/);
  if (!match) {
    return null;
  }
  const value = Number(match[0]);
  return Number.isFinite(value) ? value : null;
}

/** Numeric bounds of a command: its slider, else its numeric options. */
function boundsOf(set) {
  if (set?.slider) {
    return { min: set.slider.min, max: set.slider.max };
  }
  const numbers = (set?.options ?? []).map(Number).filter(Number.isFinite);
  return numbers.length > 1 ? { min: Math.min(...numbers), max: Math.max(...numbers) } : null;
}

const word = (text) =>
  String(text ?? '')
    .trim()
    .toLowerCase();

// --- What FHEM writes -------------------------------------------------------------

const ON = new Set(['on', 'an', 'ein', 'true', '1', 'yes']);
const OFF = new Set(['off', 'aus', 'false', '0', 'no']);

/** on/off of a switch or light: "on", "off", "dim50%", "on-for-timer 60", "level 30"... */
export function readOnOff(text) {
  const w = word(text);
  if (ON.has(w) || /^on[-_ ]/.test(w)) {
    return 1;
  }
  if (OFF.has(w) || /^off[-_ ]/.test(w)) {
    return 0;
  }
  const dim = w.match(/^(?:dim|level|pct)\s*(\d+(?:\.\d+)?)\s*%?$/);
  if (dim) {
    return Number(dim[1]) > 0 ? 1 : 0;
  }
  return null;
}

const OPEN_WORDS = new Set(['open', 'opened', 'tilted', 'offen', 'gekippt', 'on', '1', 'true']);
const CLOSED_WORDS = new Set(['closed', 'close', 'geschlossen', 'zu', 'off', '0', 'false']);

/** A contact: open (or tilted) -> 0, closed -> 1 (OPENING_SENSOR_STATE). */
export function readContact(text) {
  const w = word(text).split(/[\s(]/)[0];
  if (OPEN_WORDS.has(w)) {
    return OPENING_SENSOR_STATE.OPEN;
  }
  if (CLOSED_WORDS.has(w)) {
    return OPENING_SENSOR_STATE.CLOSE;
  }
  return null;
}

const MOTION_WORDS = new Set(['motion', 'on', 'detected', 'open', 'alarm', '1', 'true', 'yes']);
const NO_MOTION_WORDS = new Set([
  'nomotion',
  'no_motion',
  'no motion',
  'off',
  'closed',
  'clear',
  'noalarm',
  '0',
  'false',
  'no',
]);

export function readMotion(text) {
  const w = word(text);
  if (MOTION_WORDS.has(w)) {
    return 1;
  }
  if (NO_MOTION_WORDS.has(w)) {
    return 0;
  }
  return null;
}

/** PRESENCE, ROOMMATE, RESIDENTS: present/absent (home/gone/away...). */
export function readPresence(text) {
  const w = word(text);
  if (['present', 'home', 'awoken', 'asleep', 'gotosleep', 'on', '1'].includes(w)) {
    return 1;
  }
  if (['absent', 'gone', 'away', 'none', 'off', '0'].includes(w)) {
    return 0;
  }
  return null;
}

/** locked -> 1, unlocked/open -> 0 (LOCK.STATE of the core). */
export function readLock(text) {
  const w = word(text);
  if (['locked', 'lock', 'closed', 'secured'].includes(w)) {
    return 1;
  }
  if (['unlocked', 'unlock', 'open', 'opened', 'unsecured'].includes(w)) {
    return 0;
  }
  return null;
}

/** battery "ok" -> 0, "low" -> 1. */
export function readBatteryLow(text) {
  const w = word(text);
  if (['low', 'empty', 'critical', 'warn', 'warning', '1', 'true', 'yes', 'on'].includes(w)) {
    return 1;
  }
  if (['ok', 'good', 'high', 'normal', '0', 'false', 'no', 'off'].includes(w)) {
    return 0;
  }
  return null;
}

// --- The measurements read on any device -----------------------------------------

/**
 * A reading name -> a Gladys sensor. The first reading present wins in each
 * group (a thermostat has measured-temp, a sensor temperature).
 */
export const MEASUREMENTS = [
  {
    role: 'temperature',
    readings: ['temperature', 'measured-temp', 'measuredTemperature', 'temp'],
    spec: { category: C.TEMPERATURE_SENSOR, type: T.SENSOR.DECIMAL, unit: U.CELSIUS },
    min: -100,
    max: 150,
  },
  {
    role: 'humidity',
    readings: ['humidity'],
    spec: { category: C.HUMIDITY_SENSOR, type: T.SENSOR.DECIMAL, unit: U.PERCENT },
    min: 0,
    max: 100,
  },
  {
    role: 'pressure',
    readings: ['pressure', 'airPressure'],
    spec: { category: C.PRESSURE_SENSOR, type: T.SENSOR.DECIMAL, unit: U.HECTO_PASCAL },
    min: 0,
    max: 2000,
  },
  {
    role: 'co2',
    readings: ['co2', 'CO2'],
    spec: { category: C.CO2_SENSOR, type: T.SENSOR.INTEGER, unit: U.PPM },
    min: 0,
    max: 10_000,
    integer: true,
  },
  {
    role: 'illuminance',
    readings: ['luminance', 'illuminance', 'lux'],
    spec: { category: C.LIGHT_SENSOR, type: T.SENSOR.DECIMAL, unit: U.LUX },
    min: 0,
    max: 200_000,
  },
  {
    role: 'power_meter',
    readings: ['power', 'currentPower'],
    // On a switch, a switch/power; elsewhere an energy-sensor/power.
    power: true,
    unit: U.WATT,
    min: -100_000,
    max: 100_000,
  },
  {
    role: 'energy',
    readings: ['energy', 'energyTotal'],
    power: true,
    unit: U.KILOWATT_HOUR,
    min: 0,
    max: BIG,
  },
  {
    role: 'battery',
    readings: ['batteryPercent', 'batteryLevel', 'battery'],
    spec: { category: C.BATTERY, type: T.BATTERY.INTEGER, unit: U.PERCENT },
    min: 0,
    max: 100,
    integer: true,
  },
];

// --- Kinds of devices -------------------------------------------------------------

const SECURITY_TYPES = new Set(['lock', 'garage', 'security', 'alarm']);
const NOT_SWITCHES = new Set([
  'blind',
  'thermostat',
  'thermometer',
  'contact',
  'window',
  'motion',
  'sensor',
  'lock',
  'garage',
  'security',
  'alarm',
  'presence',
  'scene',
]);

/** Commands of this device are a security choice (allow_security_commands). */
export function isSecurityDevice(device) {
  const gdt = genericType(device);
  if (SECURITY_TYPES.has(gdt)) {
    return true;
  }
  const sets = parseSets(device?.PossibleSets);
  return sets.has('lock') && sets.has('unlock');
}

const BLIND_COMMANDS = [
  ['open', 'close', 'stop'],
  ['open', 'closed', 'stop'],
  ['up', 'down', 'stop'],
  ['auf', 'zu', 'stop'],
];
const POSITION_READINGS = ['pct', 'position', 'level'];
const TARGET_READINGS = ['desired-temp', 'desiredTemperature', 'desired'];

/**
 * @param {object} device an entry of jsonlist2
 * @param {object} [options] { allowSecurity, invertBlinds }
 * @returns {object[] | { skipped: string }}
 */
export function mapDevice(device, options = {}) {
  const gdt = genericType(device);
  if (gdt === 'ignore' || device?.Attributes?.ignore === '1') {
    return { skipped: 'ignored' };
  }
  const sets = parseSets(device?.PossibleSets);
  const has = (name) => sets.has(name);
  const present = (name) => readingOf(device, name) !== undefined;
  const security = isSecurityDevice(device);
  const writable = !security || options.allowSecurity === true;
  const features = [];
  const add = (feature) => features.push(feature);

  // Locks: their state, commanded only when allowed.
  const isLock = gdt === 'lock' || (has('lock') && has('unlock'));
  if (isLock) {
    const reading = present('lock') ? 'lock' : 'state';
    if (present(reading)) {
      const canWrite = writable && has('lock') && has('unlock');
      add({
        role: 'lock',
        reading,
        spec: {
          category: C.LOCK,
          type: T.LOCK.BINARY,
          min: 0,
          max: 1,
          read_only: !canWrite,
          has_feedback: true,
        },
        read: readLock,
        ...(canWrite ? { write: (v) => (Number(v) === 1 ? 'lock' : 'unlock') } : {}),
      });
    }
  }

  // Blinds: position (pct) and open/close/stop.
  const blindCommands = BLIND_COMMANDS.find((names) => names.slice(0, 2).every(has));
  // A dimmer has up/down too (HomeMatic): with on/off, it is not a blind.
  const isBlind =
    gdt === 'blind' || (gdt === '' && blindCommands !== undefined && !(has('on') && has('off')));
  if (isBlind) {
    const reading = POSITION_READINGS.find((r) => present(r) || has(r));
    if (reading) {
      const canWrite = has(reading);
      const bounds = boundsOf(sets.get(reading)) ?? { min: 0, max: 100 };
      const span = bounds.max - bounds.min || 100;
      const invert = options.invertBlinds === true;
      add({
        role: 'position',
        reading,
        main: true,
        spec: {
          category: C.SHUTTER,
          type: T.SHUTTER.POSITION,
          unit: U.PERCENT,
          min: 0,
          max: 100,
          read_only: !canWrite,
          has_feedback: true,
        },
        read: (text) => {
          const n = parseNumber(text);
          if (n === null) {
            // HomeMatic writes "open" and "closed" at the ends.
            const contact = readContact(text);
            if (contact === null) {
              return null;
            }
            const open = contact === OPENING_SENSOR_STATE.OPEN ? 100 : 0;
            return invert ? 100 - open : open;
          }
          const pct = clamp(Math.round(((n - bounds.min) / span) * 100), 0, 100);
          return invert ? 100 - pct : pct;
        },
        ...(canWrite
          ? {
              write: (v) => {
                const pct = clamp(Math.round(Number(v)), 0, 100);
                const target = invert ? 100 - pct : pct;
                return `${reading} ${Math.round(bounds.min + (target / 100) * span)}`;
              },
            }
          : {}),
      });
    }
    const commands = blindCommands ?? BLIND_COMMANDS.find((names) => names.slice(0, 2).every(has));
    if (commands) {
      const [openCmd, closeCmd, stopCmd] = commands;
      add({
        role: 'shutter',
        reading: 'state',
        spec: {
          category: C.SHUTTER,
          type: T.SHUTTER.STATE,
          min: -1,
          max: 1,
          read_only: false,
          has_feedback: false,
        },
        write: (v) => {
          const n = Number(v);
          if (n === COVER_STATE.OPEN) {
            return openCmd;
          }
          if (n === COVER_STATE.CLOSE) {
            return closeCmd;
          }
          if (n === COVER_STATE.STOP && has(stopCmd)) {
            return stopCmd;
          }
          throw new WriteError('unsupported_value');
        },
      });
    }
  }

  // Thermostats: the setpoint.
  const targetReading = TARGET_READINGS.find((r) => present(r) || has(r));
  if (targetReading && (gdt === 'thermostat' || gdt === '' || gdt === 'thermometer')) {
    const bounds = boundsOf(sets.get(targetReading)) ?? { min: 5, max: 30 };
    const canWrite = has(targetReading);
    add({
      role: 'target',
      reading: targetReading,
      main: !isBlind,
      spec: {
        category: C.THERMOSTAT,
        type: T.THERMOSTAT.TARGET_TEMPERATURE,
        unit: U.CELSIUS,
        min: Math.floor(bounds.min),
        max: Math.ceil(bounds.max),
        read_only: !canWrite,
        has_feedback: true,
      },
      read: parseNumber,
      ...(canWrite
        ? {
            write: (v) => {
              const n = Number(v);
              if (!Number.isFinite(n) || n < bounds.min || n > bounds.max) {
                throw new WriteError('out_of_range');
              }
              return `${targetReading} ${Math.round(n * 10) / 10}`;
            },
          }
        : {}),
    });
  }

  // Switches and lights: on/off, brightness.
  const onOffCommands = has('on') && has('off');
  const isSwitchLike =
    !isLock &&
    !isBlind &&
    !NOT_SWITCHES.has(gdt) &&
    (['switch', 'outlet', 'light'].includes(gdt) ||
      (onOffCommands && readOnOff(readingOf(device, 'state')) !== null));
  let category = null;
  if (isSwitchLike && present('state')) {
    const brightness = ['pct', 'dim'].find((r) => has(r));
    const isLight = gdt === 'light' || (gdt === '' && brightness !== undefined);
    category = isLight ? C.LIGHT : C.SWITCH;
    const canWrite = onOffCommands && writable;
    add({
      role: 'onoff',
      reading: 'state',
      main: true,
      spec: {
        category,
        type: isLight ? T.LIGHT.BINARY : T.SWITCH.BINARY,
        min: 0,
        max: 1,
        read_only: !canWrite,
        has_feedback: true,
      },
      read: readOnOff,
      ...(canWrite ? { write: (v) => (Number(v) === 1 ? 'on' : 'off') } : {}),
    });
    if (isLight && brightness) {
      const bounds = boundsOf(sets.get(brightness)) ?? { min: 0, max: 100 };
      const span = bounds.max - bounds.min || 100;
      add({
        role: 'brightness',
        reading: brightness,
        spec: {
          category: C.LIGHT,
          type: T.LIGHT.BRIGHTNESS,
          unit: U.PERCENT,
          min: 0,
          max: 100,
          read_only: false,
          has_feedback: present(brightness),
        },
        read: (text) => {
          const n = parseNumber(text);
          return n === null ? null : clamp(Math.round(((n - bounds.min) / span) * 100), 0, 100);
        },
        write: (v) => {
          const pct = clamp(Math.round(Number(v)), 0, 100);
          return `${brightness} ${Math.round(bounds.min + (pct / 100) * span)}`;
        },
      });
    }
  }

  // Contacts (doors, windows, garage doors): read only.
  const contactReading = present('contact')
    ? 'contact'
    : ['contact', 'window', 'garage'].includes(gdt) && present('state')
      ? 'state'
      : undefined;
  if (contactReading && !isBlind) {
    add({
      role: 'contact',
      reading: contactReading,
      main: features.length === 0,
      spec: {
        category: C.OPENING_SENSOR,
        type: T.SENSOR.BINARY,
        min: 0,
        max: 1,
        read_only: true,
        has_feedback: false,
      },
      read: readContact,
    });
  }

  // Motion and presence detectors.
  const motionReading = present('motion')
    ? 'motion'
    : gdt === 'motion' && present('state')
      ? 'state'
      : undefined;
  if (motionReading) {
    add({
      role: 'motion',
      reading: motionReading,
      spec: {
        category: C.MOTION_SENSOR,
        type: T.SENSOR.BINARY,
        min: 0,
        max: 1,
        read_only: true,
        has_feedback: false,
      },
      read: readMotion,
    });
  }
  const presenceReading = present('presence')
    ? 'presence'
    : ['PRESENCE', 'ROOMMATE', 'GUEST'].includes(typeOf(device)) && present('state')
      ? 'state'
      : undefined;
  if (presenceReading) {
    add({
      role: 'presence',
      reading: presenceReading,
      spec: {
        category: C.PRESENCE_SENSOR,
        type: T.SENSOR.BINARY,
        min: 0,
        max: 1,
        read_only: true,
        has_feedback: false,
      },
      read: readPresence,
    });
  }

  // Measurements, on any device.
  for (const m of MEASUREMENTS) {
    const reading = m.readings.find((r) => present(r));
    if (!reading) {
      continue;
    }
    const value = readingOf(device, reading);
    if (m.role === 'battery' && parseNumber(value) === null) {
      // "ok" / "low": a low battery detector.
      if (readBatteryLow(value) !== null) {
        add({
          role: 'battery_low',
          reading,
          spec: {
            category: C.BATTERY_LOW,
            type: T.SENSOR.BINARY,
            min: 0,
            max: 1,
            read_only: true,
            has_feedback: false,
          },
          read: readBatteryLow,
        });
      }
      continue;
    }
    if (parseNumber(value) === null) {
      continue;
    }
    const spec = m.power
      ? {
          category: category === C.SWITCH ? C.SWITCH : C.ENERGY_SENSOR,
          type:
            m.role === 'energy'
              ? category === C.SWITCH
                ? T.SWITCH.ENERGY
                : T.ENERGY_SENSOR.ENERGY
              : category === C.SWITCH
                ? T.SWITCH.POWER
                : T.ENERGY_SENSOR.POWER,
          unit: m.unit,
        }
      : m.spec;
    add({
      role: m.role,
      reading,
      spec: { ...spec, min: m.min, max: m.max, read_only: true, has_feedback: false },
      read: (text) => {
        const n = parseNumber(text);
        if (n === null) {
          return null;
        }
        return m.integer ? Math.round(n) : n;
      },
      throttle: true,
    });
  }

  if (features.length === 0) {
    return { skipped: typeOf(device) || 'unknown' };
  }
  return features;
}
