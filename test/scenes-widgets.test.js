// The scene action and the dashboard widget.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { statusContent } from '../src/widgets.js';
import { addDevice, baseConfig, createWorld, deviceOf } from './helpers/world.js';

test('send_command: any device, the command as typed', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const ack = await world.fake.sceneAction('send_command', {
    device: 'Mode_Alarme',
    command: 'armed',
  });
  assert.equal(ack.success, false, 'an alarm follows the security switch');
  const plug = await world.fake.sceneAction('send_command', {
    device: 'Prise_Bureau',
    command: 'off',
  });
  assert.equal(plug.success, true, plug.error);
  assert.deepEqual(world.fhem.commands.at(-1), { device: 'Prise_Bureau', args: 'off' });
  for (const [fields, error] of [
    [{ device: 'Bad name', command: 'on' }, /nom d'un appareil/],
    [{ device: 'Prise_Bureau', command: ' ' }, /commande à envoyer/],
    [{ device: 'Prise_Bureau', command: 'on; shutdown' }, /sans ; ni accolades/],
    [{ device: 'Prise_Bureau', command: 'on {system("x")}' }, /sans ; ni accolades/],
    [{ device: 'Prise.*', command: 'on' }, /nom d'un appareil/],
    [{ device: 'Prise_.', command: 'on' }, /ne connaît pas .*Prise_\./],
    [{ device: 'Prise_Bureau', command: 'explode' }, /refusé la commande : Unknown argument/],
  ]) {
    const refused = await world.fake.sceneAction('send_command', fields);
    assert.equal(refused.success, false, JSON.stringify(fields));
    assert.match(refused.error, error);
  }
  assert.equal(world.fhem.commands.length, 1);
});

test('send_command: a lock follows the security switch', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const ack = await world.fake.sceneAction('send_command', {
    device: 'Serrure',
    command: 'unlock',
  });
  assert.equal(ack.success, false);
  assert.match(ack.error, /désactivées/);
  assert.deepEqual(world.fhem.commands, []);
  const allowed = await createWorld({ config: baseConfig({ allow_security_commands: true }) });
  t.after(() => allowed.app.stop());
  const ok = await allowed.fake.sceneAction('send_command', {
    device: 'Serrure',
    command: 'unlock',
  });
  assert.equal(ok.success, true, ok.error);
});

test('the widget passes the SDK validation in every state, and reloads the devices', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await addDevice(world, deviceOf(world, 'Lampe_Salon'));
  for (const status of ['online', 'unreachable', 'auth_failed', 'not_configured', 'connecting']) {
    for (const live of [true, false]) {
      const content = statusContent(
        { status, live, version: 'rev. 31759', offered: 30, added: 1 },
        'de',
      );
      assert.doesNotThrow(() => validateWidgetContent(content), `${status} ${live}`);
    }
  }
  const got = await world.fake.widgetGet('status', { settings: {}, language: 'fr' });
  assert.equal(got.success, true, got.error);
  const values = got.data.content.components.filter((c) => c.type === 'value').map((c) => c.value);
  assert.equal(values[1], 1, 'one device added');
  const before = world.fhem.requests.length;
  const action = await world.fake.widgetAction('status', 'reload');
  assert.equal(action.success, true, action.error);
  assert.equal(action.data.message.fr, 'Liste des appareils relue.');
  assert.ok(world.fhem.requests.slice(before).includes('jsonlist2'));
});
