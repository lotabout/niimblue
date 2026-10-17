import {
  NiimbotBluetoothClient,
  NiimbotPacket,
  ConnectEvent,
  ConnectResult,
  DisconnectEvent,
  RawPacketSentEvent,
  PrintError,
  PrinterErrorCode,
  ResponseCommandId,
  Utils,
  Validators,
  type NiimbotBluetoothClientConnectOptions,
  type PacketReceivedEvent,
} from "@mmote/niimbluelib";

const PRINTER_CHARACTERISTIC = "bef8d6c9-9c21-4c9e-b632-bd58c1009f9f";
const IOS_MIN_WRITE_INTERVAL_MS = 100;
const IOS_RATE_LIMIT_RETRY_DELAYS_MS = [1000, 2000, 4000];

interface IOSConnection {
  device: BluetoothDevice;
  server: BluetoothRemoteGATTServer;
  channel?: BluetoothRemoteGATTCharacteristic;
  writeMethod?: "writeValueWithResponse" | "writeValueWithoutResponse";
  writeIntervalMs: number;
  writeQueue: Promise<void>;
  onDisconnect: () => void;
  onNotification: () => void;
}

/** Workarounds for niimbluelib 0.47.1 and iOS Web Bluetooth bridges. */
export class BluetoothClient extends NiimbotBluetoothClient {
  private iosConnection?: IOSConnection;

  override async connect(options?: NiimbotBluetoothClientConnectOptions) {
    const isIOS =
      /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);

    if (!isIOS) return super.connect(options);

    // Keep the picker in the click handler's user activation.
    const device =
      options?.authorizedDevice ??
      (await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: this.getServiceUuidFilter(),
      }));
    await this.disconnect();
    if (!device.gatt) throw new Error("Device has no Bluetooth Generic Attribute Profile");

    const session: IOSConnection = {
      device,
      server: device.gatt,
      writeIntervalMs: IOS_MIN_WRITE_INTERVAL_MS,
      writeQueue: Promise.resolve(),
      onDisconnect: () => {
        if (this.iosConnection !== session) return;
        this.releaseIOSConnection(session);
      },
      onNotification: () => {
        if (this.iosConnection === session && session.channel?.value) {
          this.processRawPacket(session.channel.value);
        }
      },
    };
    this.iosConnection = session;
    device.addEventListener("gattserverdisconnected", session.onDisconnect);
    let stage = "GATT connect";
    try {
      session.server = await device.gatt.connect();
      for (const uuid of this.getServiceUuidFilter()) {
        stage = `getPrimaryService ${uuid}`;
        let service: BluetoothRemoteGATTService;
        try {
          service = await session.server.getPrimaryService(uuid);
        } catch (error) {
          if (error instanceof Error && error.name === "NotFoundError") continue;
          throw error;
        }
        stage = `getCharacteristic ${PRINTER_CHARACTERISTIC}`;
        try {
          // Prefer the printer data channel over other writable/notifiable
          // characteristics, such as firmware update channels.
          session.channel = await service.getCharacteristic(PRINTER_CHARACTERISTIC);
        } catch (error) {
          if (!(error instanceof Error) || error.name !== "NotFoundError") throw error;
          stage = "getCharacteristics fallback";
          session.channel = (await service.getCharacteristics()).find(
            (channel) =>
              channel.properties.notify && (channel.properties.write || channel.properties.writeWithoutResponse),
          );
        }
        if (session.channel) break;
      }
      if (!session.channel) throw new Error("Suitable device characteristic not found");
      this.assertIOSConnection(session);
      // Some iOS bridges fail repeated writes without response. Prefer
      // acknowledged writes when supported and select before sending commands.
      if (session.channel.properties.write && typeof session.channel.writeValueWithResponse === "function") {
        session.writeMethod = "writeValueWithResponse";
      } else if (
        session.channel.properties.writeWithoutResponse &&
        typeof session.channel.writeValueWithoutResponse === "function"
      ) {
        session.writeMethod = "writeValueWithoutResponse";
      } else {
        throw new Error("Printer characteristic has no supported write method");
      }
      stage = `startNotifications ${session.channel.uuid}`;
      session.channel.addEventListener("characteristicvaluechanged", session.onNotification);
      await session.channel.startNotifications();
      this.assertIOSConnection(session);
      stage = "initial negotiation and printer info";
      await this.negotiateAndGetPrinterInfo();
      this.assertIOSConnection(session);
      const info = { deviceName: device.name, result: this.printerInfo.connectResult ?? ConnectResult.FirmwareErrors };
      this.emit("connect", new ConnectEvent(info));
      return info;
    } catch (error) {
      if (this.iosConnection === session) await this.disconnect();
      else session.server.disconnect();
      throw new Error(`Bluetooth ${stage}: ${error}`, { cause: error });
    }
  }

  private assertIOSConnection(session: IOSConnection) {
    if (this.iosConnection !== session) throw new Error("Bluetooth disconnected during initialization");
  }

  private releaseIOSConnection(session: IOSConnection) {
    this.stopHeartbeat();
    session.device.removeEventListener("gattserverdisconnected", session.onDisconnect);
    session.channel?.removeEventListener("characteristicvaluechanged", session.onNotification);
    this.iosConnection = undefined;
    this.emit("disconnect", new DisconnectEvent());
  }

  override isConnected() {
    return this.iosConnection?.channel !== undefined || super.isConnected();
  }

  override async disconnect() {
    const session = this.iosConnection;
    if (!session) return super.disconnect();
    this.releaseIOSConnection(session);
    session.server.disconnect();
  }

  override getPacketInterval() {
    return Math.max(super.getPacketInterval(), this.iosConnection?.writeIntervalMs ?? 0);
  }

  override async sendRaw(data: Uint8Array, force?: boolean) {
    const session = this.iosConnection;
    if (!session) return super.sendRaw(data, force);
    const send = async () => {
      // A separate queue also serializes forced writes, which bypass the
      // protocol mutex while a command is waiting for its response.
      const writing = session.writeQueue.then(async () => {
        let retryDelayMs = 0;
        for (let attempt = 0; ; attempt++) {
          await Utils.sleep(Math.max(this.packetIntervalMs, session.writeIntervalMs, retryDelayMs));
          this.assertIOSConnection(session);
          if (!session.channel || !session.writeMethod) throw new Error("Channel is closed");
          const method = `${session.writeMethod} ${session.channel.uuid}`;
          try {
            // Preserve the view's byte offset and length when passing a buffer.
            await session.channel[session.writeMethod](new Uint8Array(data).buffer);
          } catch (error) {
            // Only replay requests explicitly rejected by the bridge's rate
            // limiter. Other failures may have already delivered printer data.
            const message = error instanceof Error ? error.message : String(error);
            if (
              !/rate limit exceeded[\s\S]*too many BLE requests/i.test(message) ||
              attempt >= IOS_RATE_LIMIT_RETRY_DELAYS_MS.length
            ) {
              throw new Error(`${method}: ${error}`, { cause: error });
            }
            retryDelayMs = IOS_RATE_LIMIT_RETRY_DELAYS_MS[attempt];
            // Retain the slower pace for subsequent packets in this connection.
            session.writeIntervalMs = Math.min(session.writeIntervalMs * 2, 1000);
            continue;
          }
          this.emit("rawpacketsent", new RawPacketSentEvent(data));
          return;
        }
      });
      // A rejected write must not poison the queue used by PrintEnd/cleanup.
      session.writeQueue = writing.catch(() => {});
      await writing;
    };
    if (force) await send();
    else await this.mutex.runExclusive(send);
  }

  override async sendPacketWaitResponse(packet: NiimbotPacket, timeoutMs = 1000): Promise<NiimbotPacket> {
    return this.mutex.runExclusive(async () => {
      if (packet.oneWay) {
        await this.sendPacket(packet, true);
        return new NiimbotPacket(ResponseCommandId.In_Invalid, []);
      }

      let timer: ReturnType<typeof setTimeout> | undefined;
      let listener: (event: PacketReceivedEvent) => void;
      let onTimeout: () => void;
      let received = false;
      const response = new Promise<NiimbotPacket>((resolve, reject) => {
        listener = ({ packet: incoming }) => {
          const command = incoming.command;
          const isError = command === ResponseCommandId.In_PrintError || command === ResponseCommandId.In_NotSupported;
          if (packet.validResponseIds.length && !packet.validResponseIds.some((id) => id === command) && !isError)
            return;
          received = true;
          clearTimeout(timer);
          this.off("packetreceived", listener);
          try {
            if (command === ResponseCommandId.In_PrintError) {
              Validators.arrayLengthEquals(incoming.data, 1);
              const code = incoming.data[0];
              throw new PrintError(`Print error ${code}: ${PrinterErrorCode[code] ?? "unknown"}`, code);
            }
            if (command === ResponseCommandId.In_NotSupported) throw new PrintError("Feature not supported", 0);
            resolve(incoming);
          } catch (error) {
            reject(error);
          }
        };
        this.on("packetreceived", listener);
        // Arm before sending: a notification can arrive before an iOS bridge
        // resolves its write promise. The library arms after writing.
        onTimeout = () => {
          reject(new Error(`Timeout waiting response (waited for ${Utils.bufToHex(packet.validResponseIds, ", ")})`));
        };
      });

      try {
        const sent = this.sendPacket(packet, true).then(() => {
          // Preserve the library's response timeout: packet pacing and bridge
          // write latency do not consume the time allowed for a reply.
          if (!received) timer = setTimeout(onTimeout, timeoutMs);
        });
        const [, incoming] = await Promise.all([sent, response]);
        return incoming;
      } finally {
        clearTimeout(timer);
        this.off("packetreceived", listener!);
      }
    });
  }

  protected override processRawPacket(data: DataView | Uint8Array) {
    // Bridges may provide a view into a larger buffer. The library otherwise
    // parses unrelated bytes before/after that view as part of the response.
    const bytes = data instanceof DataView ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : data;
    super.processRawPacket(bytes);
  }
}
