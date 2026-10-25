// Minimal Source RCON client (the protocol Minecraft servers speak). No dependencies.
import net from 'node:net';

const TYPE_AUTH = 3;
const TYPE_COMMAND = 2;
const MAX_PAYLOAD = 1400; // vanilla reads RCON packets into a ~1460-byte buffer and drops longer ones

export class RconDisconnected extends Error {
  constructor(message = 'RCON not connected') {
    super(message);
    this.name = 'RconDisconnected';
  }
}

export class Rcon {
  constructor({ host = '127.0.0.1', port = 25575, password, timeoutMs = 10000 }) {
    this.host = host;
    this.port = port;
    this.password = password;
    this.timeoutMs = timeoutMs;
    this.socket = null;
    this.nextId = 1;
    this.pending = new Map();
    this.buffer = Buffer.alloc(0);
    this.connected = false;
    this.queue = Promise.resolve();
  }

  connect() {
    this.close();
    this.buffer = Buffer.alloc(0);
    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ host: this.host, port: this.port });
      this.socket = socket;
      socket.setNoDelay(true);
      const fail = (err) => {
        socket.destroy();
        reject(err);
      };
      const timer = setTimeout(() => fail(new Error('RCON connect timeout')), 5000);
      socket.once('error', (err) => {
        clearTimeout(timer);
        fail(err);
      });
      socket.on('data', (chunk) => socket === this.socket && this.#onData(chunk));
      socket.on('close', () => {
        if (socket !== this.socket) return; // an old connection closing must not affect the current one
        this.connected = false;
        this.#rejectAll(new RconDisconnected('RCON connection closed'));
      });
      socket.once('connect', async () => {
        socket.on('error', () => {});
        try {
          await this.#send(TYPE_AUTH, this.password);
          clearTimeout(timer);
          this.connected = true;
          resolve();
        } catch (err) {
          clearTimeout(timer);
          fail(err);
        }
      });
    });
  }

  close() {
    this.connected = false;
    const old = this.socket;
    this.socket = null;
    old?.destroy();
    this.#rejectAll(new RconDisconnected('RCON connection closed'));
  }

  /**
   * Runs a server command (without leading slash) and resolves with its text output.
   * Commands are serialized: Paper drops the connection when requests are pipelined.
   * Rejects with RconDisconnected when there is no connection.
   */
  command(cmd) {
    const run = () => {
      if (!this.connected) throw new RconDisconnected();
      if (Buffer.byteLength(cmd, 'utf8') > MAX_PAYLOAD) return `Command too long for RCON (${Buffer.byteLength(cmd, 'utf8')} bytes)`;
      return this.#send(TYPE_COMMAND, cmd);
    };
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => {});
    return result;
  }

  #rejectAll(err) {
    for (const { reject, timer } of this.pending.values()) {
      clearTimeout(timer);
      reject(err);
    }
    this.pending.clear();
  }

  #send(type, body) {
    return new Promise((resolve, reject) => {
      const socket = this.socket;
      if (!socket) return reject(new RconDisconnected());
      const id = this.nextId++;
      if (this.nextId > 0x7fffffff) this.nextId = 1;
      const payload = Buffer.from(body, 'utf8');
      const packet = Buffer.alloc(14 + payload.length);
      packet.writeInt32LE(10 + payload.length, 0);
      packet.writeInt32LE(id, 4);
      packet.writeInt32LE(type, 8);
      payload.copy(packet, 12);
      // A command that never gets an answer means the connection is wedged: drop it.
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new RconDisconnected('RCON command timeout'));
        if (socket === this.socket) this.close();
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      socket.write(packet);
    });
  }

  #onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 4) {
      const length = this.buffer.readInt32LE(0);
      if (this.buffer.length < length + 4) return;
      const id = this.buffer.readInt32LE(4);
      const body = this.buffer.toString('utf8', 12, length + 2);
      this.buffer = this.buffer.subarray(length + 4);

      if (id === -1) {
        this.#rejectAll(new Error('RCON authentication failed'));
        continue;
      }
      const entry = this.pending.get(id);
      if (!entry) continue;
      this.pending.delete(id);
      clearTimeout(entry.timer);
      entry.resolve(body);
    }
  }
}

/** Reads a Java .properties file (handles the backslash escapes Minecraft writes, e.g. `\!` or `\=`). */
export function readProperties(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || /^\s*[#!]/.test(line)) continue;
    const m = line.match(/^\s*((?:\\.|[^=:\s\\])+)\s*[=:]?\s*(.*)$/);
    if (!m) continue;
    const unescape = (s) => s.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16))).replace(/\\(.)/g, (_, c) => ({ t: '\t', n: '\n', r: '\r', f: '\f' })[c] ?? c);
    out[unescape(m[1])] = unescape(m[2]);
  }
  return out;
}
