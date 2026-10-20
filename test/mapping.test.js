// One FHEM device -> its Gladys features: kinds, values, commands, safety.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  OPENING_SENSOR_STATE,
  mapDevice,
  parseSets,
  readContact,
  readOnOff,
} from '../src/mapping.js';
import { normalizeConfig, normalizeUrl } from '../src/config.js';
import { informParser } from '../src/fhem/client.js';

const { Results } = JSON.parse(
  await readFile(new URL('./fixtures/fhem/jsonlist2-6.4.json', import.meta.url), 'utf8'),
);
const real = (name) => structuredClone(Results.find((d) => d.Name === name));
const roles = (features) => features.map((f) => `${f.reading}-${f.role}`);
const byRole = (features, role) => features.find((f) => f.role === role);

const device = ({ sets = '', readings = {}, attributes = {}, type = 'dummy' }) => ({
  Name: 'Test',
  PossibleSets: sets,
  Internals: { NAME: 'Test', TYPE: type },
  Readings: Object.fromEntries(Object.entries(readings).map(([k, v]) => [k, { Value: v }])),
  Attributes: attributes,
});

test('PossibleSets: sliders, lists, noArg', () => {
  const sets = parseSets(
    'on:noArg off pct:slider,0,1,100 desired-temp:5.0,5.5,30.0 mode:auto,manual',
  );
  assert.deepEqual(sets.get('pct'), { options: null, slider: { min: 0, step: 1, max: 100 } });
  assert.deepEqual(sets.get('on'), { options: null, slider: null });
  assert.deepEqual(sets.get('mode').options, ['auto', 'manual']);
  assert.deepEqual(sets.get('desired-temp').options, ['5.0', '5.5', '30.0']);
});

test('the real devices of FHEM 6.4 map to the expected features', () => {
  assert.deepEqual(roles(mapDevice(real('Lampe_Salon'))), ['state-onoff']);
  assert.equal(mapDevice(real('Lampe_Salon'))[0].spec.category, 'light');
  assert.deepEqual(roles(mapDevice(real('Variateur'))), ['state-onoff', 'pct-brightness']);
  assert.deepEqual(roles(mapDevice(real('Prise_Bureau'))), [
    'state-onoff',
    'power-power_meter',
    'energy-energy',
  ]);
  assert.equal(byRole(mapDevice(real('Prise_Bureau')), 'power_meter').spec.category, 'switch');
  assert.equal(byRole(mapDevice(real('Compteur')), 'power_meter').spec.category, 'energy-sensor');
  assert.deepEqual(roles(mapDevice(real('Volet_Chambre'))), ['pct-position', 'state-shutter']);
  assert.deepEqual(roles(mapDevice(real('Thermostat_Salon'))), [
    'desired-temp-target',
    'measured-temp-temperature',
    'humidity-humidity',
  ]);
  assert.deepEqual(byRole(mapDevice(real('Thermostat_Salon')), 'target').spec.min, 5);
  assert.deepEqual(roles(mapDevice(real('Porte_Entree'))), ['state-contact']);
  assert.deepEqual(roles(mapDevice(real('Fenetre_Cuisine'))), [
    'contact-contact',
    'battery-battery_low',
  ]);
  assert.deepEqual(roles(mapDevice(real('Mouvement_Couloir'))), ['state-motion']);
  assert.deepEqual(roles(mapDevice(real('Telephone_Alice'))), ['presence-presence']);
  assert.deepEqual(roles(mapDevice(real('Sonde_Jardin'))), [
    'temperature-temperature',
    'humidity-humidity',
    'battery-battery_low',
  ]);
  assert.deepEqual(roles(mapDevice(real('Serrure'))), ['state-lock']);
  assert.deepEqual(mapDevice(real('Mode_Alarme')), { skipped: 'dummy' });
  assert.deepEqual(mapDevice(real('Notif')), { skipped: 'notify' });
});

test('values: an open door is 0, a closed one 1; on/off in their FHEM forms', () => {
  assert.equal(readContact('open'), OPENING_SENSOR_STATE.OPEN);
  assert.equal(readContact('tilted'), OPENING_SENSOR_STATE.OPEN);
  assert.equal(readContact('closed'), OPENING_SENSOR_STATE.CLOSE);
  assert.equal(readContact('open (to VCCU)'), 0);
  for (const [text, value] of [
    ['on', 1],
    ['off', 0],
    ['dim50%', 1],
    ['dim 0', 0],
    ['on-for-timer 60', 1],
    ['set_on', null],
    ['blabla', null],
  ]) {
    assert.equal(readOnOff(text), value, text);
  }
  const contact = byRole(mapDevice(real('Porte_Entree')), 'contact');
  assert.equal(contact.read('open'), 0);
  assert.equal(contact.read('closed'), 1);
});

test('blinds: pct 100 is open; inverted on demand; up/down/stop commands', () => {
  const blind = device({
    sets: 'up down stop pct:slider,0,1,100',
    readings: { pct: '30', state: 'pct 30' },
    attributes: { genericDeviceType: 'blind' },
  });
  const [position, shutter] = mapDevice(blind);
  assert.equal(position.read('30'), 30);
  assert.equal(position.read('closed'), 0);
  assert.equal(position.write(75), 'pct 75');
  assert.equal(shutter.write(1), 'up');
  assert.equal(shutter.write(-1), 'down');
  assert.equal(shutter.write(0), 'stop');
  const [inverted] = mapDevice(blind, { invertBlinds: true });
  assert.equal(inverted.read('30'), 70);
  assert.equal(inverted.write(100), 'pct 0');
  const homematic = device({
    sets: 'on off up down pct:slider,0,1,100',
    readings: { state: 'on', pct: '50' },
  });
  assert.equal(mapDevice(homematic)[0].spec.category, 'light', 'a dimmer with up/down');
});

test('commands only when PossibleSets has them', () => {
  const sensorSwitch = device({
    readings: { state: 'on' },
    attributes: { genericDeviceType: 'switch' },
  });
  const [onoff] = mapDevice(sensorSwitch);
  assert.equal(onoff.spec.read_only, true);
  assert.equal(onoff.write, undefined);
  const thermostat = device({
    readings: { 'desired-temp': '20.0' },
    attributes: { genericDeviceType: 'thermostat' },
  });
  assert.equal(mapDevice(thermostat)[0].spec.read_only, true);
  const ignored = device({
    sets: 'on off',
    readings: { state: 'on' },
    attributes: { genericDeviceType: 'ignore' },
  });
  assert.deepEqual(mapDevice(ignored), { skipped: 'ignored' });
});

test('locks and garage doors: read-only unless allowed', () => {
  const lock = device({ sets: 'lock unlock', readings: { state: 'locked' } });
  assert.equal(mapDevice(lock)[0].spec.read_only, true);
  assert.equal(mapDevice(lock)[0].read('locked'), 1);
  const allowed = mapDevice(lock, { allowSecurity: true })[0];
  assert.equal(allowed.write(0), 'unlock');
  const garage = device({
    sets: 'on off open close',
    readings: { state: 'open' },
    attributes: { genericDeviceType: 'garage' },
  });
  assert.deepEqual(roles(mapDevice(garage)), ['state-contact']);
  assert.equal(
    mapDevice(garage, { allowSecurity: true }).some((f) => f.write),
    false,
  );
});

test('the address of FHEMWEB: port 8083 and /fhem by default, no credentials', () => {
  assert.equal(normalizeUrl('192.0.2.10'), 'http://192.0.2.10:8083/fhem');
  assert.equal(normalizeUrl('http://192.0.2.10:8083'), 'http://192.0.2.10:8083/fhem');
  assert.equal(normalizeUrl('https://fhem.example/web/'), 'https://fhem.example/web');
  assert.equal(normalizeUrl('http://192.0.2.10:8083/fhem?room=all'), 'http://192.0.2.10:8083/fhem');
  assert.equal(normalizeUrl('http://user:pw@192.0.2.10'), null);
  assert.equal(normalizeUrl('ftp://x'), null);
  const config = normalizeConfig({ rooms: 'Living room, Garden', sensor_interval: '-5' });
  assert.deepEqual(config.rooms, ['living room', 'garden']);
  assert.equal(config.sensorInterval, 0);
});

test('the inform stream: one JSON array per line, cut anywhere', () => {
  const lines = [];
  const parse = informParser((entry) => lines.push(entry));
  parse('["Lampe_Salon-state","off","off"]\n["Lampe_Sa');
  parse('lon-state-ts","2026-10-20 17:49:12","2026-10-20 17:49:12"]\nnot json\n');
  assert.deepEqual(lines, [
    ['Lampe_Salon-state', 'off', 'off'],
    ['Lampe_Salon-state-ts', '2026-10-20 17:49:12', '2026-10-20 17:49:12'],
  ]);
});
