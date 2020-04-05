import { ButtplugLogger, ButtplugServerForwardedConnector, ForwardedDeviceManager, FromJSON, ButtplugMessage, ButtplugLogLevel, ButtplugServer } from "buttplug"; 4
import { EventEmitter } from "events";
import express from "express";
import expressWs from "express-ws";

const app = expressWs(express()).app;


let forwarder_connected = false;
let remote_connected = false;

class LocalDisconnector extends EventEmitter {
  public emitLocalDisconnect() {
    this.emit("disconnected");
  }
};

let local_disconnector = new LocalDisconnector();

const listener = app.listen(process.env.PORT, () => {
  console.log("Your app is listening on port " + (listener.address()! as any).port);
});


let can_run = true;
if (process.env.LOCAL_PASSWORD === "" || process.env.LOCAL_PASSWORD === undefined ||
  process.env.REMOTE_PASSWORD === "" || process.env.REMOTE_PASSWORD === undefined) {
  app.get('*', function (req, res) {
    res.send(`
    <html>
    <head>
    <title>Please finish configuring app!</title>
    </head>
    <body>
    <h2>Please finish configuring app! Local and remote password need to be set!</h2>
    <p>For more info see readme: <a href="https://github.com/qdot/buttplug-forwarder-server/blob/master/README.md">Click here</a><br /></p>
    </body>
    </html>`);
  });
  can_run = false;
}
function run_app() {
  app.use(express.static(__dirname + "/app"));

  let server: ButtplugExpressWebsocketServer;
  let connector: ButtplugServerForwardedNodeWebsocketConnector;

  app.ws('/forwarder', (client, req) => {
    console.log("Got client connection for forwarder");
    if (forwarder_connected) {
      console.log("Someone tried to connect while we already have a connection. Connection closed.");
      client.close();
      return;
    }
    connector = new ButtplugServerForwardedNodeWebsocketConnector(client);
    console.log("Starting forwarder listener...");
    connector.Listen();
    server = new ButtplugExpressWebsocketServer("Remote Server", 0);
    const fdm = new ForwardedDeviceManager(undefined, connector);
    server.AddDeviceManager(fdm);
    console.log("Starting server...");
  });

  /**
   * Derives from the base ButtplugServer class, adds capabilities to the server
   * for listening on and communicating with websockets in a native node
   * application.
   */
  class ButtplugServerForwardedNodeWebsocketConnector extends EventEmitter implements ButtplugServerForwardedConnector {
    private wsClientClosure: (msg: string) => void;

    public constructor(private wsClient: any) {
      super();
    }

    public get IsRunning(): boolean {
      return true;
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
     * Used to set up server after Websocket connection created.
     */
    private InitServer = () => {

      let password_sent = false;
      this.wsClientClosure = (msg: string) => this.wsClient.send(msg);
      this.wsClient.on("error", (err) => {
        console.log(`Error in websocket connection: ${err.message}`);
        this.wsClient.terminate();
        this.wsClient.removeAllListeners();
      });
      this.wsClient.on("close", () => {
        console.log("Local side disconnected");
        forwarder_connected = false;
        local_disconnector.emitLocalDisconnect();
        this.wsClient.removeAllListeners();
        this.emit("disconnect");
      });
      this.wsClient.on("message", async (message) => {
        console.log(message);
        // Expect the password to be a plaintext string. We'll depend
        // on SSL for the encryption. Security? :(
        if (!password_sent) {
          if (message === process.env.LOCAL_PASSWORD) {
            console.log("Client gave correct password.");
            password_sent = true;
            this.wsClient.send("ok");
          } else {
            console.log("Client gave invalid local password, disconnecting.");
            this.wsClient.close();
            this.wsClient.removeAllListeners();
            return;
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
    }
  }

  app.ws('/', (client, req) => {
    if (!forwarder_connected) {
      console.log("Remote client disconnected because local client not active.");
      client.close();
      return;
    }
    if (remote_connected) {
      console.log("Remote client already connected, disconnecting new client.");
      client.close();
      return;
    }
    server.InitServer(client);
  });

  class ButtplugExpressWebsocketServer extends ButtplugServer {
    public constructor(name: string, maxPingTime: number = 0) {
      super(name, maxPingTime);
    }

    public get IsRunning(): boolean {
      return true;
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
    public InitServer = (wsClient: any) => {
      const bs: ButtplugServer = this;
        let password_sent = false;
        wsClient.on("error", (err) => {
          console.log(`Error in websocket connection: ${err.message}`);
          wsClient.terminate();
        });
        wsClient.on("close", () => {
          console.log("Remote connection closed.");
          remote_connected = false;
        });
        local_disconnector.addListener("disconnected", () => {
          wsClient.close()
        });
        wsClient.on("message", async (message) => {
          console.log(message);
          // Expect the password to be a plaintext string. We'll depend
          // on SSL for the encryption. Security? :(
          if (!password_sent) {
            if (message === process.env.REMOTE_PASSWORD) {
              console.log("Remote client gave correct password.");
              password_sent = true;
              wsClient.send("ok");
            } else {
              console.log("Remote client gave invalid password, disconnecting.");
              wsClient.close();
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
            wsClient.send("[" + outgoing.toJSON() + "]");
          }
        });

        bs.on("message", (message) => {
          // Make sure our message is packed in an array, as the buttplug spec
          // requires.
          console.log("incoming");
          console.log(message);
          wsClient.send("[" + message.toJSON() + "]");
        });
        remote_connected = true;
    }
  }

  async function main(): Promise<void> {
    ButtplugLogger.Logger.MaximumConsoleLogLevel = ButtplugLogLevel.Debug;
  }

  main().then(() => console.log("Server Started"));
}

if (can_run) {
  run_app();
}
