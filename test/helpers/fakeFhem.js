// -----------------------------------------------------------------------------
// A fake FHEMWEB behind an injected `fetch`, built on the jsonlist2 of a real
// FHEM 6.4 (test/fixtures/fhem/jsonlist2-6.4.json: dummy devices with
// genericDeviceType, readingList and setList) and its observed behaviour:
// the CSRF token in the X-FHEM-csrfToken header, 400 without it (reads
// included), 401 with basic authentication, a refused `set` answered 200 with
// the error as text, and the inform stream (one JSON array per line:
// ["Device-reading", value, html], ["Device-reading-ts", time, time],
// ["global-DEFINED", name, name]) that stays silent when nothing changes.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';

export const USER = { username: 'gladys', password: 'correct horse' };

const LIST = JSON.parse(
  readFileSync(new URL('../fixtures/fhem/jsonlist2-6.4.json', import.meta.url), 'utf8'),
);

/** A copy of the real device list, to change freely in a test. */
export const fixture = () => structuredClone(LIST.Results);

const setNames = (device) =>
  String(device.PossibleSets ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.split(':')[0]);

/**
 * @param {object} [options]
 * @param {object[]} [options.devices]
 * @param {boolean} [options.basicAuth] FHEMWEB asks for a password
 * @param {boolean} [options.inform] the live stream answers (false: a proxy refuses it)
 */
export function createFhem({ devices = fixture(), basicAuth = false, inform = true } = {}) {
  const fhem = {
    devices,
    basicAuth,
    inform,
    down: false,
    token: 'csrf_111111111111111',
    commands: [],
    requests: [],
    streams: new Set(),
  };
  const find = (name) => fhem.devices.find((d) => d.Name === name);

  fhem.emit = (entries) => {
    const text = entries.map((e) => `${JSON.stringify(e)}\n`).join('');
    for (const stream of fhem.streams) {
      stream.enqueue(new TextEncoder().encode(text));
    }
  };

  /** A reading changes in FHEM (a module, a notify, another UI). */
  fhem.change = (name, reading, value) => {
    const device = find(name);
    device.Readings[reading] = { Value: String(value), Time: '2026-10-20 18:00:00' };
    const lines = [];
    if (reading === 'state') {
      device.Internals.STATE = String(value);
      lines.push([name, String(value), `<div id="${name}">${value}</div>`]);
    }
    lines.push([`${name}-${reading}`, String(value), String(value)]);
    lines.push([`${name}-${reading}-ts`, '2026-10-20 18:00:00', '2026-10-20 18:00:00']);
    fhem.emit(lines);
  };

  /** A new device, like `define <name> dummy`. */
  fhem.define = (device) => {
    fhem.devices.push(device);
    fhem.emit([['global-DEFINED', device.Name, device.Name]]);
  };

  /** FHEM restarted: a new CSRF token, the streams cut. */
  fhem.restart = () => {
    fhem.token = 'csrf_222222222222222';
    fhem.cutStreams();
  };

  fhem.cutStreams = () => {
    for (const stream of fhem.streams) {
      try {
        stream.close();
      } catch {
        // already closed
      }
    }
    fhem.streams.clear();
  };

  /** What a dummy does with `set`: a reading of its readingList, else its state. */
  const apply = (device, args) => {
    const [first, ...rest] = args.split(/\s+/);
    const readingList = String(device.Attributes?.readingList ?? '').split(/[\s,]+/);
    if (readingList.includes(first) && rest.length > 0) {
      fhem.change(device.Name, first, rest.join(' '));
    } else {
      fhem.change(device.Name, 'state', args);
    }
  };

  const authorized = (header) =>
    !fhem.basicAuth ||
    header === `Basic ${Buffer.from(`${USER.username}:${USER.password}`).toString('base64')}`;

  const text = (body, status = 200, headers = {}) =>
    new Response(body, {
      status,
      headers: { 'X-FHEM-csrfToken': fhem.token, 'Content-Type': 'text/plain', ...headers },
    });

  fhem.fetch = async (url, init = {}) => {
    const { pathname, searchParams } = new URL(url);
    if (fhem.down) {
      throw new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } });
    }
    if (!authorized(init.headers?.Authorization)) {
      return new Response('', { status: 401, headers: { 'WWW-Authenticate': 'Basic' } });
    }
    if (pathname !== '/fhem') {
      return new Response('', { status: 404 });
    }
    const cmd = searchParams.get('cmd');
    const informArg = searchParams.get('inform');
    fhem.requests.push(cmd ?? (informArg ? 'inform' : 'token'));
    if ((cmd || informArg) && searchParams.get('fwcsrf') !== fhem.token) {
      return text('', 400);
    }
    if (informArg) {
      if (!fhem.inform) {
        return text('', 404);
      }
      fhem.lastInform = informArg;
      let controller;
      const body = new ReadableStream({
        start(c) {
          controller = c;
        },
      });
      fhem.streams.add(controller);
      init.signal?.addEventListener('abort', () => {
        fhem.streams.delete(controller);
        try {
          controller.error(new DOMException('aborted', 'AbortError'));
        } catch {
          // already closed
        }
      });
      return new Response(body, {
        status: 200,
        headers: { 'X-FHEM-csrfToken': fhem.token, 'Content-Type': 'application/octet-stream' },
      });
    }
    if (!cmd) {
      return text('');
    }
    if (cmd === 'jsonlist2') {
      const results = structuredClone(fhem.devices);
      return text(
        JSON.stringify({
          Arg: 'jsonlist2',
          Results: results,
          totalResultsReturned: results.length,
        }),
        200,
        { 'Content-Type': 'application/json' },
      );
    }
    const set = cmd.match(/^set (\S+) (.+)$/);
    if (set) {
      const [, name, args] = set;
      const device = find(name);
      if (!device) {
        return text(`Please define ${name} first`);
      }
      const word = args.split(/\s+/)[0];
      if (!setNames(device).includes(word)) {
        return text(
          `Unknown argument ${word}, choose one of ${device.PossibleSets}`.replace(/\s+$/, ''),
        );
      }
      fhem.commands.push({ device: name, args });
      apply(device, args);
      return text('');
    }
    return text(`Unknown command ${cmd.split(' ')[0]}, try help.`);
  };

  return fhem;
}
