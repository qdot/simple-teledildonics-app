import { ButtplugLogger, ButtplugServerForwardedConnector, ForwardedDeviceManager, FromJSON, ButtplugMessage, ButtplugLogLevel, ButtplugServer } from "buttplug";
import Websocket from "ws";
import * as http from "http";
import { promisify } from "util";
import { EventEmitter } from "events";
import express from "express";
import expressWs from "express-ws";

const app = expressWs(express()).app;
app.use(express.static(__dirname + "/app"));
let forwarder_connected = false;

const listener = app.listen(process.env.PORT, () => {
 console.log("Your app is listening on port " + (listener.address()! as Websocket.AddressInfo).port);
});

/**
 * Derives from the base ButtplugServer class, adds capabilities to the server
 * for listening on and communicating with websockets in a native node
 * application.
 */
export class ButtplugServerForwardedNodeWebsocketConnector extends EventEmitter implements ButtplugServerForwardedConnector {
  private httpServer: http.Server | null = null;
  private wsServer: Websocket.Server | null = null;
  private wsClientClosure: (msg: string) => void;

  public constructor(private _port: number = 13345, private _host: string = "localhost") {
    super();
  }

  public get IsRunning(): boolean {
    return this.wsServer !== null;
  }

  public Disconnect = (): Promise<void> => {
    return Promise.resolve();
  }

  public SendMessage = (msg: ButtplugMessage): Promise<void> => {
    this.wsClientClosure("[" + msg.toJSON() + "]");
    return Promise.resolve();
  }

  /**
   * Starts an insecure (non-ssl) instance of the server. This server will not
   * be accessible from clients/applications running on https instances.
   *
   * @param port Network port to listen on (defaults to 12345)
   * @param host Host address to listen on (defaults to localhost)
   */
  public Listen = (): Promise<void> => {
    this.InitServer();
    return Promise.resolve();
  }

  /**
   * Shuts down the server, closing all connections.
   */
  public StopServer = async (): Promise<void> => {
    if (this.wsServer !== null) {
      // ws's close doesn't follow the callback style util.promisify expects (only
      // has a passing callback, no failing), so just build our own. Could've
      // wrapped it in a 2 argument closure but eh.
      for (const client of this.wsServer.clients) {
        client.close();
      }
      const wsClose = promisify(this.wsServer.close.bind(this));
      await wsClose();
      this.wsServer = null;
    }
    if (this.httpServer !== null) {
      let res;
      const p = new Promise((r, j) => { res = r; });
      this.httpServer.close(() => { this.httpServer = null; res(); });
      await p;
    }
  }

  /**
   * Used to set up server after Websocket connection created.
   */
  private InitServer = () => {
    app.ws('/forwarder', (client, req) => {
      console.log("Got client connection for forwarder");
      let password_sent = false;
      this.wsClientClosure = (msg: string) => client.send(msg);
      client.on("error", (err) => {
        console.log(`Error in websocket connection: ${err.message}`);
        client.terminate();
      });
      client.on("close", () => {
        forwarder_connected = false;
      })
      client.on("message", async (message) => {
        console.log(message);
        // Expect the password to be a plaintext string. We'll depend
        // on SSL for the encryption. Security? :(
        if (!password_sent) {
          if (message === process.env.LOCAL_PASSWORD) {
            console.log("Client gave correct password.");
            password_sent = true;
            client.send("ok");
          } else {
            console.log("Client gave invalid local password, disconnecting.");
            client.close();
          }
          // Bail before we start parsing JSON
          forwarder_connected = true;
          return;
        }
        const msg = FromJSON(message);
        for (const m of msg) {
          console.log(m);
          this.emit("message", m);
        }
      });
    });
  }
}

export class ButtplugExpressWebsocketServer extends ButtplugServer {
  public constructor(name: string, maxPingTime: number = 0) {
    super(name, maxPingTime);
  }

  public get IsRunning(): boolean {
    return true;
  }

  /**
   * Starts an insecure (non-ssl) instance of the server. This server will not
   * be accessible from clients/applications running on https instances.
   *
   * @param port Network port to listen on (defaults to 12345)
   * @param host Host address to listen on (defaults to localhost)
   */
  public StartInsecureServer = () => {
    this.InitServer();
  }

  /**
   * Shuts down the server, closing all connections.
   */
  public StopServer = async (): Promise<void> => {
    await this.Shutdown();
  }

  /**
   * Used to set up server after Websocket connection created.
   */
  private InitServer = () => {
    const bs: ButtplugServer = this;
    app.ws('/', (client, req) => {
      let password_sent = false;
      client.on("error", (err) => {
        console.log(`Error in websocket connection: ${err.message}`);
        client.terminate();
      });
      client.on("message", async (message) => {
        console.log(message);
        // Expect the password to be a plaintext string. We'll depend
        // on SSL for the encryption. Security? :(
        if (!password_sent) {
          if (message === process.env.REMOTE_PASSWORD) {
            console.log("Remote client gave correct password.");
            password_sent = true;
            client.send("ok");
          } else {
            console.log("Remote client gave invalid password, disconnecting.");
            client.close();
          }
          // Bail before we start parsing JSON
          return;
        }
        const msg = FromJSON(message);
        console.log("Sending message");
        for (const m of msg) {
          console.log("Sending message to internal buttplug server instance:");
          console.log(m);
          const outgoing = await bs.SendMessage(m);
          console.log(outgoing);
          // Make sure our message is packed in an array, as the buttplug spec
          // requires.
          client.send("[" + outgoing.toJSON() + "]");
        }
      });

      bs.on("message", function outgoing(message) {
        // Make sure our message is packed in an array, as the buttplug spec
        // requires.
        console.log("incoming");
        console.log(message);
        client.send("[" + message.toJSON() + "]");
      });
    });
  }
}

async function main(): Promise<void> {
    ButtplugLogger.Logger.MaximumConsoleLogLevel = ButtplugLogLevel.Debug;
    const server = new ButtplugExpressWebsocketServer("Remote Server", 0);
    const connector = new ButtplugServerForwardedNodeWebsocketConnector();
    console.log("Starting forwarder listener...");
    connector.Listen();
    const fdm = new ForwardedDeviceManager(undefined, connector);
    server.AddDeviceManager(fdm);
    console.log("Starting server...");
    server.StartInsecureServer();
}

main().then(() => console.log("Server Started"));
