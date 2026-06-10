import { browserRuntimeConnect } from "../browser";
import Message from "./message";

class PortMessage extends Message {
  port: any | null = null;
  listenCallback: any = undefined;

  constructor(port?: any) {
    super();

    if (port) {
      this.port = port;
      this._watchDisconnect();
    }
  }

  // When the other side goes away (popup closed, tab navigated), drop the
  // port so late responses become no-ops instead of throwing
  // "Attempting to use a disconnected port object".
  private _watchDisconnect() {
    this.port?.onDisconnect?.addListener(() => {
      this.port = null;
      this._dispose();
    });
  }

  connect(name?: string) {
    this.port = browserRuntimeConnect(name ? { name } : undefined);
    this._watchDisconnect();
    this.port.onMessage.addListener(
      async ({ _type_, data }: { _type_: string; data: any }) => {
        if (_type_ === `${this._EVENT_PRE}message`) {
          this.emit("message", data);
          return;
        }

        if (_type_ === `${this._EVENT_PRE}response`) {
          await this.onResponse(data);
        }
      }
    );

    return this;
  }

  async listen(listenCallback: any) {
    if (!this.port) return;
    this.listenCallback = listenCallback;
    this.port.onMessage.addListener(
      async ({ _type_, data }: { _type_: string; data: any }) => {
        if (_type_ === `${this._EVENT_PRE}request`) {
          await this.onRequest(data);
        }
      }
    );

    return this;
  }

  send(type: string, data: any) {
    if (!this.port) return;
    try {
      this.port.postMessage({ _type_: `${this._EVENT_PRE}${type}`, data });
    } catch (e) {
      // The port can die between the null-check and postMessage (e.g. the
      // popup closes while a request is in flight). Treat that as a no-op.
      if (
        e instanceof Error &&
        e.message.includes("disconnected port object")
      ) {
        this.port = null;
        this._dispose();
        return;
      }
      console.error(e);
    }
  }

  dispose() {
    this._dispose();
    this.port?.disconnect();
    this.port = null;
  }
}

export default PortMessage;
