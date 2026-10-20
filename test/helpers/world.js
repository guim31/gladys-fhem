// -----------------------------------------------------------------------------
// A complete test world: the SDK's fake Gladys (a real GladysIntegration on an
// in-memory transport), the integration wired on it by registerHandlers, and
// the fake FHEM. Short timings: everything settles in milliseconds.
// -----------------------------------------------------------------------------

import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { createLogger } from '@gladysassistant/integration-sdk';
import { registerHandlers } from '../../src/app.js';
import { createFhem } from './fakeFhem.js';

export const FAST_TIMINGS = {
  reconnectMin: 20,
  reconnectMax: 80,
  authRetry: 200,
  inventoryDebounce: 20,
  pollInterval: 60_000,
  streamMaxAge: 60 * 60_000,
  streamMinLife: 60_000,
  streamRetryMax: 80,
  commandReadBack: 20,
};
export const FAST_PUBLISHER = { flushInterval: 10 };

export const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

/** Waits for a condition, failing with `what` after a while. */
export async function until(check, { what = 'the condition', timeout = 2000 } = {}) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await check()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Timed out waiting for ${what}`);
}

export const baseConfig = (extra = {}) => ({ url: 'http://192.0.2.10:8083', ...extra });

/**
 * @param {object} [options]
 * @param {object} [options.fhem] the fake FHEM (default: the real device list)
 * @param {object} [options.config] integration config (default: the fake's address)
 * @param {object[]} [options.devices] devices already added in Gladys
 */
export async function createWorld({
  fhem = createFhem(),
  config,
  devices = [],
  connect = true,
  waitOnline = true,
  logger = createLogger({ level: 'silent' }),
  timings = FAST_TIMINGS,
} = {}) {
  const gladys = createFakeGladys({ config: config ?? baseConfig(), devices });
  const app = registerHandlers(gladys, {
    fetch: fhem.fetch,
    timings,
    publisherTimings: FAST_PUBLISHER,
    logger,
  });
  if (connect) {
    await gladys.connect();
    await app.ready;
    if (waitOnline && !fhem.down) {
      await until(() => app.bridge.status === 'online', { what: 'FHEM online' });
      if (fhem.inform) {
        await until(() => app.bridge.live, { what: 'the live stream' });
      }
    }
  }
  return { gladys, fake: gladys.fake, app, bridge: app.bridge, fhem };
}

/** The discovered device of a FHEM device. */
export function deviceOf(world, name) {
  const id = world.bridge.inventory.deviceIds.get(name);
  return world.fake.discoveredDevices.find((d) => d.external_id === id);
}

/** The discovered feature of one device, reading and role. */
export function featureOf(world, name, reading, role) {
  const device = deviceOf(world, name);
  const feature = device?.features.find(
    (f) => f.external_id === `${device.external_id}:${reading}-${role}`,
  );
  if (!feature) {
    throw new Error(`No feature ${reading}-${role} for ${name}`);
  }
  return feature;
}

/** Adds a discovered device to Gladys, like the user in the Discovery tab. */
export async function addDevice(world, device) {
  const created = structuredClone(device);
  await world.fake.deviceCreated(created);
  await settle();
  return created;
}

/** Waits for the publisher's next flush. */
export async function flushed(world) {
  await settle();
  await world.bridge.publisher.flush();
  await settle();
}

export const statesOf = (world, featureId) =>
  world.fake.states.filter((s) => s.device_feature_external_id === featureId).map((s) => s.state);
