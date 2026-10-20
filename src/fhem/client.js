// -----------------------------------------------------------------------------
// FHEMWEB, the web front end of FHEM (port 8083), with the fetch of Node 22.
//
//   GET <base>?XHR=1                         the CSRF token, in the header
//                                            X-FHEM-csrfToken (absent when
//                                            the csrfToken attribute is none)
//   GET <base>?cmd=jsonlist2&XHR=1&fwcsrf=T  every device: Name, Internals
//                                            (TYPE, FUUID), Readings,
//                                            Attributes, PossibleSets
//   GET <base>?cmd=set <dev> <args>&XHR=1&fwcsrf=T
//                                            a command: an empty answer is a
//                                            success, a text is FHEM's error
//   GET <base>?XHR=1&inform=type=status;filter=.*;since=null;fmt=JSON&fwcsrf=T
//                                            the live updates: one JSON array
//                                            per line, never ending
//
// Verified against FHEM 6.4 (fhem/fhem in Docker): EVERY cmd, a read included,
// needs the token (400 with an empty body without it, or with a stale one
// after a restart of FHEM); a basic authentication (an `allowed` device)
// answers 401; an unknown device or a refused set answers 200 with the error
// as text. The live stream is silent while nothing changes.
// -----------------------------------------------------------------------------

export const CLIENT_TIMINGS = { requestTimeout: 15_000 };

/** FHEM refused the credentials (401, 403). */
export class FhemAuthError extends Error {
  constructor(status) {
    super(`HTTP ${status}`);
    this.name = 'FhemAuthError';
    this.status = status;
  }
}

/** FHEMWEB answered with an error status. */
export class FhemHttpError extends Error {
  constructor(status) {
    super(`HTTP ${status}`);
    this.name = 'FhemHttpError';
    this.status = status;
  }
}

/** FHEM answered a command with an error text. */
export class FhemCommandError extends Error {
  constructor(text) {
    const detail = String(text).trim().split('\n')[0].slice(0, 200);
    super(detail);
    this.name = 'FhemCommandError';
    this.detail = detail;
  }
}

/** Builds the Authorization header; never logged. */
export function authorization({ username, password }) {
  return username
    ? `Basic ${Buffer.from(`${username}:${password ?? ''}`).toString('base64')}`
    : undefined;
}

/**
 * Splits the inform stream into its lines and parses them. Feed it text
 * chunks; it calls `onLine([name, value, html])` for every complete line.
 */
export function informParser(onLine) {
  let buffer = '';
  return (chunk) => {
    buffer += chunk;
    let index;
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (line === '') {
        continue;
      }
      let entry;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }
      if (Array.isArray(entry) && typeof entry[0] === 'string') {
        onLine(entry);
      }
    }
  };
}

const reasonOf = (err) => {
  // undici hides the reason (ECONNREFUSED, ENOTFOUND...) in `cause`.
  const reason = err?.cause?.code ?? err?.cause?.message ?? err?.message ?? String(err);
  return err?.name === 'TimeoutError' ? 'timeout' : reason;
};

export class FhemClient {
  /**
   * @param {object} options
   * @param {string} options.baseUrl normalized by src/config.js (http://host:8083/fhem)
   * @param {string} [options.username]
   * @param {string} [options.password]
   * @param {typeof fetch} [options.fetch]
   * @param {object} [options.timings]
   */
  constructor({ baseUrl, username, password, fetch = globalThis.fetch, timings }) {
    this.baseUrl = baseUrl;
    this.auth = authorization({ username, password });
    this.fetch = fetch;
    this.timings = { ...CLIENT_TIMINGS, ...timings };
    /** undefined: not read yet; '': FHEM has none (csrfToken none). */
    this.token = undefined;
  }

  headers() {
    return this.auth ? { Authorization: this.auth } : {};
  }

  async get(query, { signal } = {}) {
    try {
      return await this.fetch(`${this.baseUrl}?${query}`, {
        headers: this.headers(),
        signal: signal ?? AbortSignal.timeout(this.timings.requestTimeout),
        redirect: 'error',
      });
    } catch (err) {
      throw new Error(reasonOf(err), { cause: err });
    }
  }

  static async check(response) {
    if (response.status === 401 || response.status === 403) {
      await response.body?.cancel().catch(() => {});
      throw new FhemAuthError(response.status);
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      throw new FhemHttpError(response.status);
    }
  }

  /** Reads the CSRF token again. */
  async refreshToken() {
    const response = await this.get('XHR=1');
    await FhemClient.check(response);
    await response.text().catch(() => '');
    this.token = response.headers.get('x-fhem-csrftoken') ?? '';
    return this.token;
  }

  tokenParam() {
    return this.token ? `&fwcsrf=${encodeURIComponent(this.token)}` : '';
  }

  /**
   * Runs one FHEM command, returns its text output. A 400 is a stale token
   * (FHEM restarted): read again, and the command tried once more.
   * @param {string} command
   */
  async command(command) {
    if (this.token === undefined) {
      await this.refreshToken();
    }
    const query = () => `cmd=${encodeURIComponent(command)}&XHR=1${this.tokenParam()}`;
    let response = await this.get(query());
    if (response.status === 400) {
      await response.body?.cancel().catch(() => {});
      await this.refreshToken();
      response = await this.get(query());
    }
    await FhemClient.check(response);
    return response.text();
  }

  /** Every device of FHEM (jsonlist2), and the version of FHEM. */
  async getDevices() {
    const text = await this.command('jsonlist2');
    let list;
    try {
      list = JSON.parse(text);
    } catch {
      throw new Error('unexpected answer to jsonlist2');
    }
    if (!Array.isArray(list?.Results)) {
      throw new Error('unexpected answer to jsonlist2');
    }
    const devices = list.Results.filter((d) => typeof d?.Name === 'string');
    // "fhem.pl:31759/2026-10-10": the revision of FHEM, in the attributes of global.
    const global = devices.find((d) => d.Name === 'global');
    const version = String(global?.Attributes?.version ?? '').match(/fhem\.pl:(\d+)/);
    return { devices, version: version ? `rev. ${version[1]}` : '' };
  }

  /**
   * `set <device> <args>`; throws FhemCommandError with FHEM's answer when it
   * refuses (unknown device, argument, value).
   */
  async set(device, args) {
    const answer = await this.command(`set ${device} ${args}`);
    if (String(answer ?? '').trim() !== '') {
      throw new FhemCommandError(answer);
    }
  }

  /**
   * Opens the live updates. Resolves once FHEM accepted them, with
   * `{ close, done }`: `done` settles when the stream ends (closed by FHEM,
   * the network, or `close()`).
   * @param {(entry: string[]) => void} onLine
   */
  async openInform(onLine) {
    if (this.token === undefined) {
      await this.refreshToken();
    }
    const controller = new AbortController();
    // A timeout for the answer only: the stream itself lives on.
    const timer = setTimeout(
      () => controller.abort(new DOMException('timeout', 'TimeoutError')),
      this.timings.requestTimeout,
    );
    const query = () =>
      `XHR=1&inform=${encodeURIComponent('type=status;filter=.*;since=null;fmt=JSON')}${this.tokenParam()}&timestamp=${Date.now()}`;
    let response;
    try {
      response = await this.get(query(), { signal: controller.signal });
      if (response.status === 400) {
        await response.body?.cancel().catch(() => {});
        await this.refreshToken();
        response = await this.get(query(), { signal: controller.signal });
      }
    } finally {
      clearTimeout(timer);
    }
    if (response.status === 401 || response.status === 403) {
      controller.abort();
      throw new FhemAuthError(response.status);
    }
    if (!response.ok || !response.body) {
      controller.abort();
      throw new FhemHttpError(response.status);
    }
    const parse = informParser(onLine);
    const decoder = new TextDecoder();
    const reader = response.body.getReader();
    const done = (async () => {
      try {
        for (;;) {
          const { value, done: finished } = await reader.read();
          if (finished) {
            return;
          }
          parse(decoder.decode(value, { stream: true }));
        }
      } catch {
        // Aborted or cut: the caller sees the end of the stream.
      }
    })();
    return {
      close: () => {
        controller.abort();
        reader.cancel().catch(() => {});
      },
      done,
    };
  }
}
