// -----------------------------------------------------------------------------
// The bridge: one FHEM server, its devices, the live states, the commands
// and the scene events.
//
//   connect    CSRF token, then jsonlist2 (devices, readings, attributes,
//              commands), with a user name and password or nothing;
//   inventory  src/inventory.js -> publishDiscoveredDevices (Discovery tab);
//   live       the inform stream of FHEMWEB: reading changes -> the features
//              of the devices ADDED in Gladys only (the others would be
//              dropped by the core and spend its 300 states/min); a device
//              defined, deleted, renamed or an attribute changed -> the list
//              is read again;
//   recycle    FHEM says nothing on a quiet stream, so a dead connection
//              cannot be told from a quiet house: the stream is reopened
//              every 15 minutes, and the list read again then;
//   fallback   no stream (cut, refused by a proxy): the list is read every
//              30 s, and the stream opened again with a growing delay;
//   commands   onSetValue -> set <device> <args>; the reading change that
//              follows is the feedback;
//   events     watched_devices -> trigger `device_changed`;
//   failures   FHEM lost -> unreachable badges, new attempt after 5 s,
//              doubling up to 60 s (refused credentials: every minute).
// -----------------------------------------------------------------------------

import { DEVICE_TRANSPORTS } from '@gladysassistant/integration-sdk';
import { matcher, normalizeConfig } from './config.js';
import { FhemAuthError, FhemClient, FhemCommandError } from './fhem/client.js';
import { buildInventory } from './inventory.js';
import { WriteError, readingOf } from './mapping.js';
import { StatePublisher } from './publisher.js';
import { ERRORS, STATUS, localizedError, testMessage } from './texts.js';

export const BRIDGE_TIMINGS = {
  reconnectMin: 5000,
  reconnectMax: 60_000,
  authRetry: 60_000,
  inventoryDebounce: 2000,
  // Without the stream, the devices are read this often.
  pollInterval: 30_000,
  // A quiet stream may be a dead one: reopened this often, the list read again.
  streamMaxAge: 15 * 60_000,
  // A stream that ends sooner without a line was not working.
  streamMinLife: 60_000,
  streamRetryMax: 5 * 60_000,
  // A command while polling: its result is read back after this delay.
  commandReadBack: 1500,
};

export const TRIGGERS = { DEVICE_CHANGED: 'device_changed' };
export const WIDGET_KEY = 'status';

/** Scene events per minute: the core takes 300, a chatty device must not spend them all. */
export const EVENTS_PER_MINUTE = 120;

/** The core refuses a discovered list longer than this (setDiscoveredDevices, 5.2.0). */
export const MAX_DISCOVERED_DEVICES = 2000;

/** Events of the `global` device that change the device list. */
const GLOBAL_EVENTS = new Set(['DEFINED', 'DELETED', 'RENAMED', 'MODIFIED', 'INITIALIZED']);

const short = (value, max = 255) => {
  const text = String(value ?? '');
  return text.length > max ? text.slice(0, max) : text;
};

/** What the inventory is built from: a change here offers the devices again. */
const structureOf = (devices) =>
  JSON.stringify(
    devices.map((d) => [
      d.Name,
      d.Internals?.TYPE,
      d.Internals?.FUUID,
      d.Attributes?.alias,
      d.Attributes?.room,
      d.Attributes?.genericDeviceType,
      d.Attributes?.ignore,
      d.PossibleSets,
      Object.keys(d.Readings ?? {}).sort(),
    ]),
  );

export class Bridge {
  constructor({
    gladys,
    logger,
    fetch,
    timers = globalThis,
    timings = BRIDGE_TIMINGS,
    clientTimings,
    publisherTimings,
    now = Date.now,
  }) {
    this.gladys = gladys;
    this.logger = logger;
    this.fetch = fetch;
    this.timers = timers;
    this.timings = { ...BRIDGE_TIMINGS, ...timings };
    this.clientTimings = clientTimings;
    this.now = now;
    this.publisher = new StatePublisher({
      gladys,
      logger,
      now,
      timers,
      timings: publisherTimings,
    });
    this.config = normalizeConfig({});
    this.configKey = undefined;
    this.status = 'not_configured';
    this.version = undefined;
    this.client = undefined;
    /** device name -> jsonlist2 entry (its Readings kept up to date by the stream) */
    this.devices = new Map();
    /** "device reading" -> time of its last change received by the stream */
    this.changedAt = new Map();
    this.structure = undefined;
    this.inventory = this.emptyInventory();
    this.generation = 0;
    this.reconnectTimer = undefined;
    this.inventoryTimer = undefined;
    this.tickTimer = undefined;
    this.streamTimer = undefined;
    this.stream = undefined;
    this.live = false;
    this.streamOpenedAt = 0;
    this.streamLines = 0;
    this.streamSeq = 0;
    this.streamFailing = false;
    this.recycling = false;
    this.delay = this.timings.reconnectMin;
    this.streamDelay = this.timings.reconnectMin;
    this.transports = new Map();
    this.eventWindow = [];
    this.eventsDropped = false;
    this.watched = matcher([]);
  }

  emptyInventory() {
    return buildInventory([], { externalIds: this.gladys.externalIds.bind(this.gladys) });
  }

  // --- Configuration and lifecycle -----------------------------------------------

  /** Applies a configuration; restarts the connection when it changed. */
  async configure(raw) {
    const key = JSON.stringify(raw ?? {});
    if (key === this.configKey && this.status !== 'not_configured') {
      return;
    }
    this.configKey = key;
    this.config = normalizeConfig(raw);
    this.watched = matcher(this.config.watched);
    this.publisher.setInterval(this.config.sensorInterval);
    await this.restart();
  }

  async restart() {
    this.disconnect();
    this.generation += 1;
    this.delay = this.timings.reconnectMin;
    this.streamDelay = this.timings.reconnectMin;
    this.structure = undefined;
    // Nothing of the previous server survives a new configuration.
    this.devices = new Map();
    this.changedAt.clear();
    this.transports.clear();
    this.inventory = this.emptyInventory();
    this.publisher.clear();
    this.publisher.start();
    if (this.config.invalidUrl || !this.config.url) {
      this.status = this.config.invalidUrl ? 'invalid_url' : 'not_configured';
      await this.setConnectionStatus(false, STATUS[this.status]);
      return;
    }
    await this.connect(this.generation);
  }

  /** Stops everything (shutdown, tests). */
  stop() {
    this.generation += 1;
    this.disconnect();
    this.publisher.stop();
  }

  disconnect() {
    for (const timer of [this.reconnectTimer, this.inventoryTimer, this.streamTimer]) {
      this.timers.clearTimeout(timer);
    }
    this.timers.clearInterval(this.tickTimer);
    this.reconnectTimer = undefined;
    this.inventoryTimer = undefined;
    this.streamTimer = undefined;
    this.tickTimer = undefined;
    this.closeStream();
    this.client = undefined;
  }

  closeStream() {
    this.streamSeq += 1;
    const stream = this.stream;
    this.stream = undefined;
    this.live = false;
    stream?.close();
  }

  async setConnectionStatus(connected, message) {
    try {
      await this.gladys.setConnectionStatus(connected, message);
    } catch (err) {
      this.logger.debug(`Connection status not sent: ${err.message}`);
    }
  }

  async connect(generation) {
    if (generation !== this.generation) {
      return;
    }
    if (this.status !== 'unreachable' && this.status !== 'auth_failed') {
      this.status = 'connecting';
    }
    const client = new FhemClient({
      baseUrl: this.config.url,
      username: this.config.username,
      password: this.config.password,
      fetch: this.fetch,
      timings: this.clientTimings,
    });
    let list;
    try {
      list = await client.getDevices();
    } catch (err) {
      if (generation === this.generation) {
        await this.onFailure(generation, err);
      }
      return;
    }
    if (generation !== this.generation) {
      return;
    }
    const wasDown = this.status === 'unreachable' || this.status === 'auth_failed';
    this.client = client;
    this.status = 'online';
    this.version = list.version || undefined;
    this.delay = this.timings.reconnectMin;
    await this.applyDevices(list.devices, { force: true });
    this.logger.info(
      `${wasDown ? 'Connected again' : 'Connected'} to FHEM${this.version ? ` ${this.version}` : ''}: ${this.inventory.devices.length} devices offered`,
    );
    await this.setConnectionStatus(true);
    await this.publishTransports();
    this.requestWidgetRefresh();
    this.timers.clearInterval(this.tickTimer);
    this.tickTimer = this.timers.setInterval(() => {
      this.tick(generation).catch((err) => this.logger.debug(`Tick failed: ${err.message}`));
    }, this.timings.pollInterval);
    this.openStream(generation);
  }

  async onFailure(generation, err) {
    const auth = err instanceof FhemAuthError;
    const status = auth ? 'auth_failed' : 'unreachable';
    this.timers.clearInterval(this.tickTimer);
    this.tickTimer = undefined;
    this.timers.clearTimeout(this.streamTimer);
    this.closeStream();
    this.client = undefined;
    if (this.status !== status) {
      // One line at the first failure, one at the recovery: not one per attempt.
      this.logger.warn(
        auth ? `FHEM refused the access (${err.message})` : `FHEM is unreachable: ${err.message}`,
      );
    }
    this.status = status;
    await this.setConnectionStatus(false, STATUS[status]);
    await this.publishTransports();
    this.requestWidgetRefresh();
    this.timers.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = this.timers.setTimeout(
      () => {
        this.reconnectTimer = undefined;
        this.connect(generation).catch((e) => this.logger.error(e.message));
      },
      auth ? this.timings.authRetry : this.delay,
    );
    if (!auth) {
      this.delay = Math.min(this.delay * 2, this.timings.reconnectMax);
    }
  }

  // --- Live stream ---------------------------------------------------------------

  async openStream(generation) {
    if (generation !== this.generation || this.status !== 'online' || !this.client) {
      return;
    }
    this.streamSeq += 1;
    const seq = this.streamSeq;
    let stream;
    try {
      stream = await this.client.openInform((entry) => this.onInformLine(entry, stream));
    } catch (err) {
      if (generation === this.generation && seq === this.streamSeq) {
        this.onStreamDown(generation, err.message);
      }
      return;
    }
    // A newer attempt (after a loss and a reconnection) owns the stream now.
    if (generation !== this.generation || this.status !== 'online' || seq !== this.streamSeq) {
      stream.close();
      return;
    }
    this.stream?.close();
    this.stream = stream;
    this.live = true;
    this.streamOpenedAt = this.now();
    this.streamLines = 0;
    if (this.streamFailing) {
      // Changes may have been missed while it was down.
      this.refresh(generation).catch(() => {});
    }
    stream.done.then(() => {
      if (this.stream !== stream) {
        return;
      }
      this.stream = undefined;
      this.live = false;
      if (this.recycling) {
        this.recycling = false;
        this.openStream(generation).catch(() => {});
        this.refresh(generation).catch(() => {});
        return;
      }
      // A stream that lived, or carried lines, was working: its end is a plain cut.
      if (this.streamLines > 0 || this.now() - this.streamOpenedAt >= this.timings.streamMinLife) {
        this.streamDelay = this.timings.reconnectMin;
      }
      this.onStreamDown(generation, 'stream ended');
    });
  }

  onStreamDown(generation, reason) {
    if (generation !== this.generation || this.status !== 'online') {
      return;
    }
    if (!this.streamFailing) {
      this.streamFailing = true;
      this.logger.warn(`FHEM live updates unavailable (${reason}): devices read every 30 s`);
      this.requestWidgetRefresh();
    }
    this.timers.clearTimeout(this.streamTimer);
    this.streamTimer = this.timers.setTimeout(() => {
      this.streamTimer = undefined;
      this.openStream(generation).catch(() => {});
    }, this.streamDelay);
    this.streamDelay = Math.min(this.streamDelay * 2, this.timings.streamRetryMax);
  }

  /** One line of the inform stream: ["Device-reading", value, html]. */
  onInformLine([key, value], stream) {
    if (stream && stream !== this.stream) {
      return;
    }
    this.streamLines += 1;
    this.streamWorks();
    // FHEM device names never hold a "-": the first one splits the reading off.
    const dash = key.indexOf('-');
    if (key.startsWith('#') || dash <= 0) {
      return;
    }
    const name = key.slice(0, dash);
    const rest = key.slice(dash + 1);
    if (rest.endsWith('-ts')) {
      return;
    }
    if (name === 'global') {
      if (GLOBAL_EVENTS.has(rest)) {
        this.scheduleInventory();
      }
      return;
    }
    if (rest.startsWith('a-')) {
      // An attribute changed (room, alias, genericDeviceType, setList...).
      this.scheduleInventory();
      return;
    }
    this.onReading(name, rest, String(value ?? ''));
  }

  onReading(name, reading, value) {
    const device = this.devices.get(name);
    if (!device) {
      return;
    }
    const previous = readingOf(device, reading);
    device.Readings ??= {};
    const isNew = previous === undefined;
    device.Readings[reading] = { ...device.Readings[reading], Value: value };
    this.changedAt.set(`${name} ${reading}`, this.now());
    this.pushReading(name, reading);
    if (isNew) {
      // A new reading may make a new feature: the list is read again.
      this.scheduleInventory();
    }
    if (this.watched(name) && previous !== value) {
      this.sceneEvent(TRIGGERS.DEVICE_CHANGED, {
        device: name,
        alias: short(device.Attributes?.alias || name),
        reading,
        value: short(value),
        old_value: short(previous ?? ''),
      });
    }
  }

  /**
   * The stream works once it carried a line or lived a while: a proxy that
   * accepts it and cuts it at once must not log a recovery every few seconds.
   */
  streamWorks() {
    if (!this.streamFailing) {
      return;
    }
    if (this.streamLines === 0 && this.now() - this.streamOpenedAt < this.timings.streamMinLife) {
      return;
    }
    this.streamFailing = false;
    this.streamDelay = this.timings.reconnectMin;
    this.logger.info('FHEM live updates work again');
    this.requestWidgetRefresh();
  }

  /** Every 30 s: the list when the stream is down, the stream recycled when old. */
  async tick(generation) {
    if (generation !== this.generation || this.status !== 'online') {
      return;
    }
    if (this.live) {
      this.streamWorks();
    }
    if (!this.live) {
      await this.refresh(generation);
      return;
    }
    if (this.now() - this.streamOpenedAt >= this.timings.streamMaxAge && this.stream) {
      this.logger.debug('FHEM live updates reopened');
      // Its end opens it again and reads the list.
      this.recycling = true;
      this.stream.close();
    }
  }

  // --- Devices and inventory -----------------------------------------------------

  async refresh(generation = this.generation) {
    if (generation !== this.generation || this.status !== 'online' || !this.client) {
      return;
    }
    const started = this.now();
    let list;
    try {
      list = await this.client.getDevices();
    } catch (err) {
      if (generation === this.generation && this.status === 'online') {
        await this.onFailure(generation, err);
      }
      return;
    }
    if (generation !== this.generation) {
      return;
    }
    this.version = list.version || this.version;
    // A change received while the list was read is newer than the list: it is kept.
    for (const device of list.devices) {
      const known = this.devices.get(device.Name);
      for (const reading of Object.keys(known?.Readings ?? {})) {
        const changed = this.changedAt.get(`${device.Name} ${reading}`);
        if (changed !== undefined && changed >= started && device.Readings?.[reading]) {
          device.Readings[reading] = { ...device.Readings[reading], ...known.Readings[reading] };
        }
      }
    }
    await this.applyDevices(list.devices);
  }

  /** New device list: states updated, devices offered again when the structure changed. */
  async applyDevices(list, { force = false } = {}) {
    const previous = this.devices;
    this.devices = new Map(list.map((d) => [d.Name, d]));
    const structure = structureOf([...this.devices.values()]);
    if (force || structure !== this.structure) {
      this.structure = structure;
      this.inventory = buildInventory([...this.devices.values()], {
        ...this.config,
        externalIds: this.gladys.externalIds.bind(this.gladys),
      });
      await this.publishDevices();
      if (!force) {
        await this.publishTransports();
      }
    }
    // Without the stream, the watched devices start their scenes from here.
    for (const [name, device] of this.devices) {
      const before = previous.get(name);
      if (!before || !this.watched(name)) {
        continue;
      }
      for (const reading of Object.keys(device.Readings ?? {})) {
        const old = readingOf(before, reading);
        const value = readingOf(device, reading);
        if (old !== undefined && old !== value) {
          this.sceneEvent(TRIGGERS.DEVICE_CHANGED, {
            device: name,
            alias: short(device.Attributes?.alias || name),
            reading,
            value: short(value),
            old_value: short(old),
          });
        }
      }
    }
    this.pushAll();
  }

  async publishDevices() {
    if (!this.gladys.connected) {
      return;
    }
    let devices = this.inventory.devices;
    if (devices.length > MAX_DISCOVERED_DEVICES) {
      // The core refuses the whole list beyond it: the first ones are offered.
      this.logger.warn(
        `${devices.length} devices: only the first ${MAX_DISCOVERED_DEVICES} are offered, narrow the selection`,
      );
      devices = devices.slice(0, MAX_DISCOVERED_DEVICES);
    }
    try {
      await this.gladys.publishDiscoveredDevices(devices);
    } catch (err) {
      this.logger.warn(`Publishing the discovered devices failed: ${err.message}`);
    }
  }

  scheduleInventory(delay = this.timings.inventoryDebounce) {
    if (this.inventoryTimer) {
      return;
    }
    const generation = this.generation;
    this.inventoryTimer = this.timers.setTimeout(() => {
      this.inventoryTimer = undefined;
      this.refresh(generation).catch((err) =>
        this.logger.warn(`Reading the FHEM devices failed: ${err.message}`),
      );
    }, delay);
  }

  /** Scan button, widget "Reload": the devices now, and offered again. */
  async scan() {
    if (this.status === 'online' && this.client) {
      this.structure = undefined;
      await this.refresh();
    } else {
      await this.publishDevices();
    }
  }

  // --- States --------------------------------------------------------------------

  /** The external ids of the features of OUR devices added in Gladys. */
  createdFeatures() {
    const ids = new Set();
    for (const device of this.gladys.devices ?? []) {
      for (const feature of device.features ?? []) {
        ids.add(feature.external_id);
      }
    }
    return ids;
  }

  pushReading(name, reading, created = this.createdFeatures()) {
    const device = this.devices.get(name);
    const value = readingOf(device, reading);
    if (value === undefined) {
      return;
    }
    for (const route of this.inventory.routes.get(name)?.get(reading) ?? []) {
      if (!created.has(route.featureId)) {
        continue;
      }
      let state;
      try {
        state = route.read(value);
      } catch {
        state = null;
      }
      if (state !== null && state !== undefined && Number.isFinite(state)) {
        this.publisher.push(route.featureId, state, route.throttle);
      }
    }
  }

  pushAll() {
    const created = this.createdFeatures();
    for (const [name, readings] of this.inventory.routes) {
      for (const reading of readings.keys()) {
        this.pushReading(name, reading, created);
      }
    }
  }

  /** unreachable for every device while FHEM is. */
  async publishTransports() {
    if (!this.gladys.connected) {
      return;
    }
    const offered = new Set(this.inventory.devices.map((d) => d.external_id));
    const transport =
      this.status === 'online' ? DEVICE_TRANSPORTS.LOCAL : DEVICE_TRANSPORTS.UNREACHABLE;
    const entries = [];
    for (const device of this.gladys.devices ?? []) {
      const id = device.external_id;
      // While FHEM is lost, the inventory is the last one read: its devices are badged.
      if (offered.has(id) && this.transports.get(id) !== transport) {
        this.transports.set(id, transport);
        entries.push({ external_id: id, transport });
      }
    }
    for (let i = 0; i < entries.length; i += 100) {
      try {
        await this.gladys.publishTransports(entries.slice(i, i + 100));
      } catch (err) {
        for (const entry of entries.slice(i, i + 100)) {
          this.transports.delete(entry.external_id);
        }
        this.logger.debug(`Transport badges not sent: ${err.message}`);
      }
    }
  }

  // --- Gladys events -------------------------------------------------------------

  async onGladysConnected() {
    this.transports.clear();
    if (
      this.configKey === undefined ||
      JSON.stringify(this.gladys.config ?? {}) !== this.configKey
    ) {
      await this.configure(this.gladys.config ?? {});
      return;
    }
    await this.publishDevices();
    this.pushAll();
    await this.publishTransports();
  }

  async onDeviceCreated(device) {
    // The SDK forgot the values of this device: they are sent again now.
    this.publisher.forget(device.external_id);
    this.transports.delete(device.external_id);
    this.pushAll();
    await this.publishTransports();
    this.requestWidgetRefresh();
  }

  async onDeviceDeleted(device) {
    this.publisher.forget(device.external_id);
    this.transports.delete(device.external_id);
    this.requestWidgetRefresh();
  }

  requestWidgetRefresh() {
    if (this.gladys.connected) {
      // Fire-and-forget in the SDK: it may return nothing.
      Promise.resolve()
        .then(() => this.gladys.requestWidgetRefresh(WIDGET_KEY))
        .catch(() => {});
    }
  }

  // --- Commands ------------------------------------------------------------------

  error(key, detail = '') {
    return localizedError(ERRORS[key], this.config.language, detail);
  }

  /** One `set` to one device, the one way out for devices and scenes. */
  async sendCommand(name, args) {
    if (this.status !== 'online' || !this.client) {
      throw this.error('offline');
    }
    try {
      await this.client.set(name, args);
    } catch (err) {
      if (err instanceof FhemCommandError) {
        throw /define .* first/i.test(err.detail)
          ? this.error('not_found', name)
          : this.error('refused', err.detail);
      }
      throw this.error('refused', err.message);
    }
    if (!this.live) {
      // No stream: the result is read back instead of waiting for the next poll.
      this.scheduleInventory(this.timings.commandReadBack);
    }
  }

  async setValue(device, feature, value) {
    const id = feature.external_id;
    const writer = this.inventory.writers.get(id);
    if (!writer) {
      const name = this.inventory.featureDevice.get(id);
      if (name && this.inventory.security.has(name)) {
        throw this.error('security_disabled');
      }
      throw this.error('unknown_feature');
    }
    let args;
    try {
      args = writer.write(value);
    } catch (err) {
      if (err instanceof WriteError) {
        throw this.error(err.key);
      }
      throw err;
    }
    this.logger.info(`Command: set ${writer.device} ${args}`);
    await this.sendCommand(writer.device, args);
  }

  // --- Scene events --------------------------------------------------------------

  sceneEvent(key, data) {
    const now = this.now();
    this.eventWindow = this.eventWindow.filter((t) => now - t < 60_000);
    if (this.eventWindow.length >= EVENTS_PER_MINUTE) {
      if (!this.eventsDropped) {
        this.eventsDropped = true;
        this.logger.warn(
          `More than ${EVENTS_PER_MINUTE} FHEM events in a minute: the next ones are dropped`,
        );
      }
      return;
    }
    this.eventsDropped = false;
    this.eventWindow.push(now);
    this.gladys
      .publishSceneEvent(key, data)
      .catch((err) => this.logger.debug(`Scene event ${key} not sent: ${err.message}`));
  }

  // --- Connection test, widget ---------------------------------------------------

  async testConnection() {
    if (this.status === 'online') {
      return testMessage({
        version: this.version ?? '',
        devices: this.inventory.devices.length,
        ignored: this.inventory.ignored,
      });
    }
    const status = ['connecting', 'online'].includes(this.status) ? 'unreachable' : this.status;
    throw localizedError(STATUS[status], this.config.language);
  }

  summary() {
    const created = new Set((this.gladys.devices ?? []).map((d) => d.external_id));
    return {
      status: this.status,
      version: this.version,
      live: this.live,
      offered: this.inventory.devices.length,
      added: this.inventory.devices.filter((d) => created.has(d.external_id)).length,
    };
  }
}
