// The bridge end to end: the SDK's fake Gladys on one side, the fake FHEMWEB
// (real device list, CSRF token, inform stream, dummy `set`) on the other.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLogger } from '@gladysassistant/integration-sdk';
import { USER, createFhem } from './helpers/fakeFhem.js';
import { captureLogs } from './helpers/logs.js';
import {
  FAST_TIMINGS,
  addDevice,
  baseConfig,
  createWorld,
  deviceOf,
  featureOf,
  flushed,
  settle,
  statesOf,
  until,
} from './helpers/world.js';

test('the FHEM devices are offered with their room, FHEM plumbing left out', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const lamp = deviceOf(world, 'Lampe_Salon');
  assert.equal(lamp.name, 'Lampe du salon');
  assert.match(lamp.external_id, /:uuid:[0-9a-f-]+$/, 'keyed on the FUUID, kept on a rename');
  assert.deepEqual(lamp.params, [
    { name: 'fhem_name', value: 'Lampe_Salon' },
    { name: 'fhem_type', value: 'dummy' },
    { name: 'fhem_room', value: 'Salon' },
  ]);
  assert.equal(deviceOf(world, 'Variateur').name, 'Variateur (Cuisine)');
  for (const name of ['WEB', 'global', 'Logfile', 'autocreate', 'Notif', 'Cache', 'Mode_Alarme']) {
    assert.equal(deviceOf(world, name), undefined, name);
  }
  for (const device of world.fake.discoveredDevices) {
    assert.equal(device.should_poll, false, device.name);
  }
  assert.match(world.fhem.lastInform, /type=status;filter=\.\*;.*fmt=JSON/);
});

test('states go to the devices added in Gladys only, all again when one is added', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await flushed(world);
  assert.equal(world.fake.states.length, 0, 'nothing added yet');
  await addDevice(world, deviceOf(world, 'Porte_Entree'));
  await flushed(world);
  const door = featureOf(world, 'Porte_Entree', 'state', 'contact').external_id;
  assert.deepEqual(statesOf(world, door), [1], 'closed is 1');
  world.fhem.change('Porte_Entree', 'state', 'open');
  await until(async () => (await flushed(world), statesOf(world, door).length === 2), {
    what: 'the live change',
  });
  assert.deepEqual(statesOf(world, door), [1, 0], 'open is 0');
});

test('a command is a set, the reading change that follows is the feedback', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const lamp = await addDevice(world, deviceOf(world, 'Lampe_Salon'));
  const onoff = featureOf(world, 'Lampe_Salon', 'state', 'onoff');
  const ack = await world.fake.setValue(lamp, onoff, 0);
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(world.fhem.commands, [{ device: 'Lampe_Salon', args: 'off' }]);
  await until(async () => (await flushed(world), statesOf(world, onoff.external_id).at(-1) === 0), {
    what: 'the feedback',
  });
  const blind = await addDevice(world, deviceOf(world, 'Volet_Chambre'));
  await world.fake.setValue(blind, featureOf(world, 'Volet_Chambre', 'pct', 'position'), 80);
  await world.fake.setValue(blind, featureOf(world, 'Volet_Chambre', 'state', 'shutter'), -1);
  const thermostat = await addDevice(world, deviceOf(world, 'Thermostat_Salon'));
  const target = featureOf(world, 'Thermostat_Salon', 'desired-temp', 'target');
  await world.fake.setValue(thermostat, target, 21.5);
  assert.deepEqual(world.fhem.commands.slice(1), [
    { device: 'Volet_Chambre', args: 'pct 80' },
    { device: 'Volet_Chambre', args: 'down' },
    { device: 'Thermostat_Salon', args: 'desired-temp 21.5' },
  ]);
  const tooHot = await world.fake.setValue(thermostat, target, 45);
  assert.equal(tooHot.success, false);
  assert.match(tooHot.error, /hors des limites/);
});

test('locks: read-only by default, commands refused with a clear message', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const lock = await addDevice(world, deviceOf(world, 'Serrure'));
  const feature = featureOf(world, 'Serrure', 'state', 'lock');
  assert.equal(feature.read_only, true);
  const ack = await world.fake.setValue(lock, feature, 0);
  assert.equal(ack.success, false);
  assert.match(ack.error, /serrures/);
  assert.deepEqual(world.fhem.commands, []);
  const allowed = await createWorld({ config: baseConfig({ allow_security_commands: true }) });
  t.after(() => allowed.app.stop());
  const unlocked = featureOf(allowed, 'Serrure', 'state', 'lock');
  assert.equal(unlocked.read_only, false);
  const added = await addDevice(allowed, deviceOf(allowed, 'Serrure'));
  assert.equal((await allowed.fake.setValue(added, unlocked, 0)).success, true);
  assert.deepEqual(allowed.fhem.commands.at(-1), { device: 'Serrure', args: 'unlock' });
});

test("FHEM's refusal comes back in the configured language", async (t) => {
  const world = await createWorld({ config: baseConfig({ language: 'de' }) });
  t.after(() => world.app.stop());
  const plug = await addDevice(world, deviceOf(world, 'Prise_Bureau'));
  world.fhem.devices = world.fhem.devices.filter((d) => d.Name !== 'Prise_Bureau');
  const ack = await world.fake.setValue(
    plug,
    featureOf(world, 'Prise_Bureau', 'state', 'onoff'),
    1,
  );
  assert.equal(ack.success, false);
  assert.match(ack.error, /FHEM kennt .*Prise_Bureau/);
});

test('basic authentication; refused credentials say so', async (t) => {
  const world = await createWorld({
    fhem: createFhem({ basicAuth: true }),
    config: baseConfig(USER),
  });
  t.after(() => world.app.stop());
  assert.equal(world.bridge.status, 'online');
  const refused = await createWorld({
    fhem: createFhem({ basicAuth: true }),
    config: baseConfig({ username: 'gladys', password: 'wrong' }),
    waitOnline: false,
  });
  t.after(() => refused.app.stop());
  await until(() => refused.bridge.status === 'auth_failed', { what: 'auth_failed' });
  assert.equal(refused.fake.connectionStatus.connected, false);
  assert.match(refused.fake.connectionStatus.message.fr, /refuse l'accès/);
});

test('FHEM restarted: the new CSRF token is read, commands go on', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  world.fhem.restart();
  const plug = await addDevice(world, deviceOf(world, 'Prise_Bureau'));
  const ack = await world.fake.setValue(
    plug,
    featureOf(world, 'Prise_Bureau', 'state', 'onoff'),
    0,
  );
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(world.fhem.commands.at(-1), { device: 'Prise_Bureau', args: 'off' });
  await until(() => world.bridge.live, { what: 'the stream again' });
});

test('FHEM lost: unreachable badges, one warning, then back with its states', async (t) => {
  const { lines } = captureLogs(t, 'info');
  const world = await createWorld({ logger: createLogger({ name: 'fhem' }) });
  t.after(() => world.app.stop());
  const door = await addDevice(world, deviceOf(world, 'Porte_Entree'));
  world.fhem.down = true;
  world.fhem.cutStreams();
  await world.bridge.refresh();
  await until(() => world.bridge.status === 'unreachable', { what: 'unreachable' });
  await settle();
  assert.deepEqual(world.fake.transports.at(-1), {
    device_external_id: door.external_id,
    transport: 'unreachable',
  });
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(lines.filter((l) => /unreachable/.test(l)).length, 1, 'one line, not one per try');
  world.fhem.down = false;
  world.fhem.devices.find((d) => d.Name === 'Porte_Entree').Readings.state.Value = 'open';
  await until(() => world.bridge.status === 'online' && world.bridge.live, { what: 'back' });
  await flushed(world);
  const id = featureOf(world, 'Porte_Entree', 'state', 'contact').external_id;
  assert.equal(statesOf(world, id).at(-1), 0);
  assert.equal(world.fake.transports.at(-1).transport, 'local');
  assert.ok(lines.some((l) => /Connected again/.test(l)));
});

test('no live stream: the devices are polled, a command read back, the stream retried', async (t) => {
  const fhem = createFhem({ inform: false });
  const world = await createWorld({ fhem, timings: { ...FAST_TIMINGS, pollInterval: 30 } });
  t.after(() => world.app.stop());
  assert.equal(world.bridge.live, false);
  await addDevice(world, deviceOf(world, 'Porte_Entree'));
  const id = featureOf(world, 'Porte_Entree', 'state', 'contact').external_id;
  fhem.devices.find((d) => d.Name === 'Porte_Entree').Readings.state.Value = 'open';
  await until(async () => (await flushed(world), statesOf(world, id).at(-1) === 0), {
    what: 'the polled state',
  });
  fhem.inform = true;
  await until(() => world.bridge.live, { what: 'the stream again' });
});

test('an old stream is reopened, and the list read again', async (t) => {
  let clock = 0;
  const world = await createWorld();
  t.after(() => world.app.stop());
  world.bridge.now = () => clock;
  world.bridge.streamOpenedAt = 0;
  clock = FAST_TIMINGS.streamMaxAge + 1;
  const count = (what) => world.fhem.requests.filter((r) => r === what).length;
  const [streams, lists] = [count('inform'), count('jsonlist2')];
  await world.bridge.tick(world.bridge.generation);
  await until(() => count('inform') > streams && count('jsonlist2') > lists && world.bridge.live, {
    what: 'a new stream and a new list',
  });
  assert.equal(world.bridge.streamFailing, false, 'a planned reopening is not a failure');
});

test('a new device in FHEM is offered without a scan', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  world.fhem.define({
    Name: 'Lampe_Jardin',
    PossibleSets: 'on off',
    Internals: {
      NAME: 'Lampe_Jardin',
      TYPE: 'dummy',
      FUUID: '6ad7aaaa-f33f-a0ae-0000-000000000001',
    },
    Readings: { state: { Value: 'off', Time: '2026-10-20 18:00:00' } },
    Attributes: { setList: 'on off', genericDeviceType: 'light' },
  });
  await until(() => deviceOf(world, 'Lampe_Jardin'), { what: 'the new device' });
});

test('a watched device starts the scene trigger, with its reading and values', async (t) => {
  const world = await createWorld({ config: baseConfig({ watched_devices: 'Mode_*' }) });
  t.after(() => world.app.stop());
  world.fhem.change('Mode_Alarme', 'state', 'armed');
  world.fhem.change('Porte_Entree', 'state', 'open');
  await until(() => world.fake.sceneEvents.length > 0, { what: 'the scene event' });
  await settle();
  assert.deepEqual(world.fake.sceneEvents, [
    {
      key: 'device_changed',
      data: {
        device: 'Mode_Alarme',
        alias: 'Mode_Alarme',
        reading: 'state',
        value: 'armed',
        old_value: 'disarmed',
      },
    },
  ]);
});

test('while polling, a watched device still starts its scenes', async (t) => {
  const fhem = createFhem({ inform: false });
  const world = await createWorld({
    fhem,
    config: baseConfig({ watched_devices: 'Mode_Alarme' }),
    timings: { ...FAST_TIMINGS, pollInterval: 30 },
  });
  t.after(() => world.app.stop());
  fhem.devices.find((d) => d.Name === 'Mode_Alarme').Readings.state.Value = 'armed';
  await until(() => world.fake.sceneEvents.length > 0, { what: 'the polled scene event' });
  assert.equal(world.fake.sceneEvents[0].data.value, 'armed');
});

test('a normal cycle writes nothing at the info level', async (t) => {
  const world = await createWorld({ logger: createLogger({ name: 'fhem' }) });
  t.after(() => world.app.stop());
  await addDevice(world, deviceOf(world, 'Sonde_Jardin'));
  const { lines, stop } = captureLogs(t, 'info');
  world.fhem.change('Sonde_Jardin', 'temperature', '13.4');
  await world.bridge.refresh();
  await flushed(world);
  assert.deepEqual(stop(), []);
  assert.deepEqual(lines, []);
});

test('the connection test gives the revision and what was not imported', async (t) => {
  const world = await createWorld({ config: baseConfig({ language: 'en' }) });
  t.after(() => world.app.stop());
  const ack = await world.fake.action('test_connection', {});
  assert.equal(ack.success, true);
  assert.match(
    ack.data.message.en,
    /^Connected to FHEM rev\. 31759: \d+ devices offered\. Not imported: dummy \(2\)/,
  );
});

test('not configured, then an invalid address: said in the status', async (t) => {
  const world = await createWorld({ config: {}, waitOnline: false });
  t.after(() => world.app.stop());
  assert.equal(world.bridge.status, 'not_configured');
  await world.bridge.configure({ url: 'ftp://nowhere' });
  assert.equal(world.bridge.status, 'invalid_url');
  assert.match(world.fake.connectionStatus.message.en, /not valid/);
});

test('rooms and exclusions narrow the devices offered', async (t) => {
  const world = await createWorld({
    config: baseConfig({ rooms: 'salon, jardin', exclude_devices: 'Thermo*' }),
  });
  t.after(() => world.app.stop());
  assert.deepEqual(world.fake.discoveredDevices.map((d) => d.params[0].value).sort(), [
    'Lampe_Salon',
    'Sonde_Jardin',
  ]);
});
