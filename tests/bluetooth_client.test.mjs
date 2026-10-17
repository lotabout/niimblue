import assert from "node:assert/strict";
import { test } from "node:test";
import {
  NiimbotBluetoothClient,
  NiimbotPacket,
  PacketReceivedEvent,
  ResponseCommandId,
  Utils,
} from "@mmote/niimbluelib";
import { BluetoothClient } from "../src/utils/bluetooth_client.ts";

const rateLimitError = () => new DOMException("Rate limit exceeded — too many BLE requests", "SecurityError");

const setNavigator = (t, userAgent) => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { userAgent, maxTouchPoints: 5 },
  });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, "navigator", original);
    else delete globalThis.navigator;
  });
};

const connectIOS = async (t, { onWrite, onSleep, withoutResponse = false, packetIntervalMs } = {}) => {
  setNavigator(t, "iPhone");
  const client = new BluetoothClient();
  client.setHeartbeatAutoStart(false);
  if (packetIntervalMs !== undefined) client.setPacketInterval(packetIntervalMs);
  // Exercise real discovery, method selection and transport, without needing
  // printer firmware to answer the unrelated information queries.
  t.mock.method(client, "negotiateAndGetPrinterInfo", async () => {});
  const writes = [];
  const delays = [];
  let now = 0;
  t.mock.method(Utils, "sleep", async (ms) => {
    delays.push(ms);
    now += ms;
    await onSleep?.({ ms, client });
  });
  const channel = Object.assign(new EventTarget(), {
    uuid: "bef8d6c9-9c21-4c9e-b632-bd58c1009f9f",
    properties: { notify: true, write: !withoutResponse, writeWithoutResponse: true },
    startNotifications: async () => channel,
    writeValueWithResponse: async (buffer) => {
      assert.equal(withoutResponse, false);
      writes.push({ bytes: [...new Uint8Array(buffer)], time: now });
      await onWrite?.({ writes, client, channel, now });
    },
    writeValueWithoutResponse: async (buffer) => {
      assert.equal(withoutResponse, true);
      writes.push({ bytes: [...new Uint8Array(buffer)], time: now });
      await onWrite?.({ writes, client, channel, now });
    },
  });
  const device = Object.assign(new EventTarget(), { name: "B1" });
  const server = {
    connect: async () => server,
    getPrimaryService: async () => ({ getCharacteristic: async () => channel }),
    disconnect: () => device.dispatchEvent(new Event("gattserverdisconnected")),
  };
  device.gatt = server;
  await client.connect({ authorizedDevice: device });
  t.after(() => client.disconnect());
  return { client, channel, device, writes, delays };
};

test("iOS defaults to paced sustained image traffic when no interval override is set", async (t) => {
  const accepted = [];
  const { client, writes, delays } = await connectIOS(t, {
    onWrite: ({ now }) => {
      // A simulated bridge accepting at most fifty writes in a rolling second.
      assert.ok(accepted.filter((time) => time > now - 1000).length < 50);
      accepted.push(now);
    },
  });
  const packet = new NiimbotPacket(0x85, [1, 2, 3]);
  packet.oneWay = true;
  for (let index = 0; index < 200; index++) await client.sendPacketWaitResponse(packet);
  assert.equal(writes.length, 200);
  assert.ok(delays.every((ms) => ms === 20));
  assert.equal(client.getPacketInterval(), 20);
});

for (const interval of [20, 0]) {
  test(`an explicit ${interval}ms interval is honored from connection through subsequent writes`, async (t) => {
    const { client, delays } = await connectIOS(t, { packetIntervalMs: interval });
    await client.sendRaw(new Uint8Array([1]));
    await client.sendRaw(new Uint8Array([2]));
    assert.deepEqual(delays, interval === 0 ? [] : [interval, interval]);
    assert.equal(client.getPacketInterval(), interval);
    assert.equal(client.getRecommendedStatusPollInterval(), 1000);
  });
}

test("interval changes apply live and reset restores the iOS default", async (t) => {
  const { client, delays } = await connectIOS(t);
  client.setPacketInterval(20);
  await client.sendRaw(new Uint8Array([1]));
  client.setPacketInterval(0);
  await client.sendRaw(new Uint8Array([2]));
  client.resetPacketInterval();
  await client.sendRaw(new Uint8Array([3]));
  assert.deepEqual(delays, [20, 20]);
  assert.equal(client.getPacketInterval(), 20);
});

test("0ms remains sequential while a bridge write is pending", async (t) => {
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  const { client, writes, delays } = await connectIOS(t, {
    packetIntervalMs: 0,
    onWrite: ({ writes }) => (writes.length === 1 ? pending : undefined),
  });
  const first = client.sendRaw(new Uint8Array([1]), true);
  const second = client.sendRaw(new Uint8Array([2]), true);
  await new Promise(setImmediate);
  assert.equal(writes.length, 1);
  release();
  await Promise.all([first, second]);
  assert.equal(writes.length, 2);
  assert.deepEqual(delays, []);
});

for (const interval of [0, 20]) {
  test(`rate limiting still retries and slows subsequent writes from ${interval}ms`, async (t) => {
    const { client, delays, device } = await connectIOS(t, {
      packetIntervalMs: interval,
      onWrite: ({ writes }) => {
        if (writes.length === 1) throw rateLimitError();
      },
    });
    await client.sendRaw(new Uint8Array([1]));
    const slowed = interval === 0 ? 20 : 40;
    assert.equal(client.getPacketInterval(), slowed);
    // Reactive settings updates with the same value must retain learned pacing.
    client.setPacketInterval(interval);
    await client.sendRaw(new Uint8Array([2]));
    assert.deepEqual(delays, interval === 0 ? [1000, slowed] : [interval, 1000, slowed]);
    await client.disconnect();
    await client.connect({ authorizedDevice: device });
    assert.equal(client.getPacketInterval(), interval);
  });
}

test("invalid interval overrides preserve the current pacing", async (t) => {
  const { client } = await connectIOS(t);
  for (const interval of [-1, NaN, Infinity]) {
    assert.throws(() => client.setPacketInterval(interval), /Invalid packet interval/);
    assert.equal(client.getPacketInterval(), 20);
  }
});

test("iOS respects a user-configured slower write interval", async (t) => {
  const { client, delays } = await connectIOS(t);
  client.setPacketInterval(350);
  await client.sendRaw(new Uint8Array([1]));
  await client.sendRaw(new Uint8Array([2]));
  assert.deepEqual(delays, [350, 350]);
  assert.equal(client.getPacketInterval(), 350);
});

for (const withoutResponse of [false, true]) {
  test(`rate-limit recovery preserves bytes, order and sent events (without response: ${withoutResponse})`, async (t) => {
    const { client, writes, delays } = await connectIOS(t, {
      withoutResponse,
      onWrite: ({ writes }) => {
        if (writes.length === 1) throw rateLimitError();
      },
    });
    const sent = [];
    client.on("rawpacketsent", (event) => sent.push(event));
    const bytes = new Uint8Array([99, 1, 2, 88]);
    await client.sendRaw(bytes.subarray(1, 3));
    await client.sendRaw(new Uint8Array([3]));
    assert.deepEqual(
      writes.map(({ bytes }) => bytes),
      [[1, 2], [1, 2], [3]],
    );
    assert.deepEqual(delays, [20, 1000, 40]);
    assert.equal(sent.length, 2);
    assert.equal(client.getPacketInterval(), 40);
  });
}

test("forced writes remain serialized while one bridge write is pending", async (t) => {
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  const { client, writes } = await connectIOS(t, {
    onWrite: ({ writes }) => (writes.length === 1 ? pending : undefined),
  });
  const first = client.sendRaw(new Uint8Array([1]), true);
  const second = client.sendRaw(new Uint8Array([2]), true);
  await new Promise(setImmediate);
  assert.equal(writes.length, 1);
  release();
  await Promise.all([first, second]);
  assert.deepEqual(
    writes.map(({ bytes }) => bytes),
    [[1], [2]],
  );
});

test("persistent rate limiting stops after bounded backoff and leaves cleanup usable", async (t) => {
  let limited = true;
  const { client, writes, delays } = await connectIOS(t, {
    onWrite: () => {
      if (limited) throw rateLimitError();
    },
  });
  const sent = [];
  client.on("rawpacketsent", (event) => sent.push(event));
  await assert.rejects(client.sendRaw(new Uint8Array([1])), (error) => {
    assert.match(error.message, /writeValueWithResponse bef8d6c9.*Rate limit exceeded/);
    assert.equal(error.cause.name, "SecurityError");
    return true;
  });
  assert.equal(writes.length, 4);
  assert.deepEqual(delays, [20, 1000, 2000, 4000]);
  assert.equal(sent.length, 0);
  limited = false;
  await client.sendRaw(new Uint8Array([2]));
  assert.equal(delays.at(-1), 160);
  assert.equal(sent.length, 1);
});

for (const failure of [
  new DOMException("Permission denied", "SecurityError"),
  new DOMException("GATT disconnected", "NetworkError"),
]) {
  test(`other write failures are never replayed: ${failure.name}`, async (t) => {
    const { client, writes } = await connectIOS(t, {
      onWrite: () => {
        throw failure;
      },
    });
    await assert.rejects(client.sendRaw(new Uint8Array([1])), (error) => error.cause === failure);
    assert.equal(writes.length, 1);
  });
}

test("disconnect during cooldown prevents another write to the stale channel", async (t) => {
  const { client, writes } = await connectIOS(t, {
    onWrite: () => {
      throw rateLimitError();
    },
    onSleep: async ({ ms, client }) => {
      if (ms === 1000) await client.disconnect();
    },
  });
  await assert.rejects(client.sendRaw(new Uint8Array([1])), /Bluetooth disconnected/);
  assert.equal(writes.length, 1);
});

test("reconnecting resets adaptive pacing and rejects writes queued for the old session", async (t) => {
  let release;
  const cooldown = new Promise((resolve) => {
    release = resolve;
  });
  const { client, device, writes, delays } = await connectIOS(t, {
    onWrite: ({ writes }) => {
      if (writes.length === 1) throw rateLimitError();
    },
    onSleep: ({ ms }) => (ms === 1000 ? cooldown : undefined),
  });
  const sending = client.sendRaw(new Uint8Array([1]), true);
  const rejected = assert.rejects(sending, /Bluetooth disconnected/);
  await new Promise(setImmediate);
  assert.equal(client.getPacketInterval(), 40);
  await client.disconnect();
  await client.connect({ authorizedDevice: device });
  assert.equal(client.getPacketInterval(), 20);
  await client.sendRaw(new Uint8Array([2]));
  release();
  await rejected;
  assert.deepEqual(
    writes.map(({ bytes }) => bytes),
    [[1], [2]],
  );
  assert.equal(delays.at(-1), 20);
});

test("a reply before the retried write resolves is retained without consuming the response timeout", async (t) => {
  const incoming = new NiimbotPacket(0x90, [1]);
  const { client, writes } = await connectIOS(t, {
    onWrite: async ({ writes, client }) => {
      if (writes.length === 1) throw rateLimitError();
      client.emit("packetreceived", new PacketReceivedEvent(incoming));
      // Deliberately exceed the requested response timeout while the bridge
      // write promise is still pending, as iOS bridges can do.
      await new Promise((resolve) => setTimeout(resolve, 15));
    },
  });
  const packet = new NiimbotPacket(0x80, [1], [0x90]);
  assert.equal(await client.sendPacketWaitResponse(packet, 5), incoming);
  assert.equal(writes.length, 2);
  assert.equal(client.listenerCount("packetreceived"), 0);
});

test("failed writes and response timeouts remove response listeners", async (t) => {
  let limited = true;
  const { client } = await connectIOS(t, {
    onWrite: () => {
      if (limited) throw rateLimitError();
    },
  });
  const packet = new NiimbotPacket(0x80, [1], [0x90]);
  await assert.rejects(client.sendPacketWaitResponse(packet, 5), /Rate limit exceeded/);
  assert.equal(client.listenerCount("packetreceived"), 0);
  limited = false;
  await assert.rejects(client.sendPacketWaitResponse(packet, 5), /Timeout waiting response/);
  assert.equal(client.listenerCount("packetreceived"), 0);
});

test("one-way packets do not wait for a reply", async (t) => {
  const { client, writes } = await connectIOS(t);
  const packet = new NiimbotPacket(0x85, [1]);
  packet.oneWay = true;
  assert.equal((await client.sendPacketWaitResponse(packet)).command, ResponseCommandId.In_Invalid);
  assert.equal(writes.length, 1);
  assert.equal(client.listenerCount("packetreceived"), 0);
});

test("non-iOS connections retain the library transport and pacing", async (t) => {
  setNavigator(t, "Android");
  const connected = { deviceName: "B1" };
  const connect = t.mock.method(NiimbotBluetoothClient.prototype, "connect", async () => connected);
  const sendRaw = t.mock.method(NiimbotBluetoothClient.prototype, "sendRaw", async () => {});
  const client = new BluetoothClient();
  assert.equal(await client.connect(), connected);
  const bytes = new Uint8Array([1]);
  await client.sendRaw(bytes, true);
  assert.equal(connect.mock.callCount(), 1);
  assert.deepEqual(sendRaw.mock.calls[0].arguments, [bytes, true]);
  assert.equal(client.getPacketInterval(), 10);
});

const captureTimingLogs = (t) => {
  const lines = [];
  t.mock.method(console, "log", (line) => {
    assert.ok(line.startsWith("[BLE timing] "));
    lines.push(JSON.parse(line.slice("[BLE timing] ".length)));
  });
  return lines;
};

test("timing logs distinguish pacing from bridge latency and can be toggled immediately", async (t) => {
  const lines = captureTimingLogs(t);
  let now = 0;
  t.mock.method(performance, "now", () => now);
  const { client } = await connectIOS(t, {
    onSleep: ({ ms }) => {
      now += ms;
    },
    onWrite: () => {
      now += 7;
    },
  });
  await client.sendRaw(new Uint8Array([1]));
  assert.equal(lines.length, 0);
  client.setTimingLogsEnabled(true);
  await client.sendRaw(new Uint8Array([2, 3]));
  assert.deepEqual(
    lines.map(({ event }) => event),
    ["write.start", "write.end"],
  );
  const [start, end] = lines;
  assert.equal(start.id, end.id);
  assert.equal(start.requestId, end.requestId);
  assert.equal(start.method, "writeValueWithResponse");
  assert.equal(start.bytes, 2);
  assert.equal(start.waitMs, 20);
  assert.equal(start.sinceQueuedMs, 20);
  assert.equal(end.elapsedMs, 7);
  assert.equal(end.atMs - start.atMs, 7);
  assert.equal(end.status, "ok");
  assert.ok(Number.isFinite(Date.parse(start.time)));
  client.setTimingLogsEnabled(false);
  await client.sendRaw(new Uint8Array([4]));
  assert.equal(lines.length, 2);
});

test("timing logs expose rejected attempts and retry cooldown with a shared write request ID", async (t) => {
  const lines = captureTimingLogs(t);
  const { client } = await connectIOS(t, {
    onWrite: ({ writes }) => {
      if (writes.length === 1) throw rateLimitError();
    },
  });
  client.setTimingLogsEnabled(true);
  await client.sendRaw(new Uint8Array([1]));
  assert.deepEqual(
    lines.map(({ event }) => event),
    ["write.start", "write.end", "write.retry", "write.start", "write.end"],
  );
  assert.equal(lines[1].status, "error");
  assert.equal(lines[1].errorName, "SecurityError");
  assert.match(lines[1].error, /Rate limit exceeded/);
  assert.equal(lines[2].retryAfterMs, 1000);
  assert.equal(lines[2].nextIntervalMs, 40);
  assert.equal(lines[3].attempt, 2);
  assert.equal(lines[3].intervalMs, 1000);
  assert.notEqual(lines[0].id, lines[3].id);
  assert.ok(lines.every(({ requestId }) => requestId === lines[0].requestId));
  assert.equal(lines[4].status, "ok");
});

test("timing logs preserve the order of early printer replies and bridge write completion", async (t) => {
  const lines = captureTimingLogs(t);
  const incoming = new NiimbotPacket(0x90, [1]);
  const { client } = await connectIOS(t, {
    onWrite: ({ client }) => client.emit("packetreceived", new PacketReceivedEvent(incoming)),
  });
  client.setTimingLogsEnabled(true);
  await client.sendPacketWaitResponse(new NiimbotPacket(0x80, [1], [0x90]));
  assert.deepEqual(
    lines.map(({ event }) => event),
    ["command.start", "write.start", "command.response", "write.end", "command.end"],
  );
  assert.equal(lines[0].id, lines[2].id);
  assert.equal(lines[0].id, lines[4].id);
  assert.equal(lines[4].status, "ok");
});

test("timing logs close both failed writes and commands without changing the error", async (t) => {
  const lines = captureTimingLogs(t);
  const failure = new DOMException("Permission denied", "SecurityError");
  const { client } = await connectIOS(t, {
    onWrite: () => {
      throw failure;
    },
  });
  client.setTimingLogsEnabled(true);
  await assert.rejects(
    client.sendPacketWaitResponse(new NiimbotPacket(0x80, [1], [0x90])),
    (error) => error.cause === failure,
  );
  assert.deepEqual(
    lines.filter(({ event }) => event.endsWith(".end")).map(({ status }) => status),
    ["error", "error"],
  );
  assert.equal(client.listenerCount("packetreceived"), 0);
});
