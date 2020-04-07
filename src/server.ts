////////////////////////////////////////////////////////////////////////////////
// Server Explanation
////////////////////////////////////////////////////////////////////////////////

// Welcome to the server portion of the Simple Teledildonics app.
//
// This server allows 1 user to share their hardware, while another user can
// connect and control it. Multiple connections are not allowed on either end,
// only one sharer and one controller at any time. The sharer must connect
// before the controller.
//
// The server hosts 3 endpoints:
//
// - /
//   - This is a dual protocol endpoint. Via HTTP, this shows the index page.
//     Via websocket, it allows people to connect to control shared hardware.
// - /forwarder
//   - This is a websocket endpoint. It allows a user to share their hardware.
// - /status
//   - This is a websocket endpoint, used by the forwader user to get status
//     about remote connections.
//
// The expected execution flow is as follows:
//
// - A user connects to the "local" (sharer) side and chooses toys to share.
// - Another user then connects to the "Remote" (controller) side to control
//   the shared toys.
// - If the "local" user disconnects, the "remote" will be disconnected.
// - Similarly, if no "local" is connected, no "remote" can connect.
//
// Security is in the form of passwords which are set in the .env file, which
// Glitch assigns to process.env. There is a separate password for local users
// and remote users, so that only those that know the password can use the
// application. The idea is that each person who wants to use the application
// should set up their own version of it, freeing us from having to deal with
// things like user databases. If the passwords are not set, the server will not
// run and will instead warn the user to set the passwords.
//
// The server is written in Typescript because it's just what I'm used to. It's
// probably doable in JS, but I kinda ran out of energy and I work much faster
// in Typescript. This doesn't use much in the way to Typescript features
// though, so hopefully it'll be fairly understandable.

////////////////////////////////////////////////////////////////////////////////
// App Setup
////////////////////////////////////////////////////////////////////////////////

// Everything we'll need from the Buttplug library, which is a lot.
import { ButtplugLogger, ButtplugServerForwardedConnector, ForwardedDeviceManager,
         FromJSON, ButtplugMessage, ButtplugLogLevel, ButtplugServer,
         RequestServerInfo } from "buttplug"; 4

// We'll need to emit events
import { EventEmitter } from "events";

// For the web server, we'll use express to handle both serving pages and
// websockets. It plays nicely with glitch, has lots of good tutorial articles
// out there, and usually "just works".
import express from "express";
import expressWs from "express-ws";

// First off, we'll set up our app. Since we need both websockets and webpages
// served, we have to wrap the express instance in a websocket instance.
const app = expressWs(express()).app;

// Set up our global status. These variables track connections to the server. We
// only ever want one connection at a time on any endpoint, and this is how we
// keep track.

// True if someone is connected to the forwarder endpoint (which means they are
// sharing their hardware for someone else to control)
let forwarder_connected = false;

// True if someone is connected to the status endpoint. This will usually be the
// same user that is connected to the forwarder endpoint, as this endpoint will
// give them updates about whether someone has connected to control their
// hardware.
let status_connected = false;

// True if someone is connected to the remote endpoint, meaning they are trying
// to control the toys of whoever is connected to the forwarder endpoint.
let remote_connected = false;

// The status emitter class exists as a "hub" class. We make a single global
// version of it, then our endpoints can fire events through it to notify each
// other of happenings on their endpoints. At the moment, this just tracks
// connects and disconnects, so that we can let the sharer know a controller has
// connected, disconnect the controller if the sharer disconnects, etc...
class StatusEmitter extends EventEmitter {
  public emitLocalDisconnect() {
    this.emit("local_disconnect");
  }

  public emitRemoteConnect() {
    console.log("Remote connected");
    this.emit("remote_connect");
  }

  public emitRemoteDisconnect() {
    this.emit("remote_disconnect");
  }
};

let status_emitter = new StatusEmitter();

// Now we actually start listening on a port. If this is running on glitch, that
// port will be 3000. Otherwise, it will be random. We output the port number to
// the command line.
const listener = app.listen(process.env.PORT, () => {
  console.log("Your app is listening on port " + (listener.address()! as any).port);
});

// Check to make sure that passwords have been set and loaded. Otherwise,
// complain whenever anyone tries to connect to any endpoint.
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

////////////////////////////////////////////////////////////////////////////////
// App Setup
////////////////////////////////////////////////////////////////////////////////
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
        status_emitter.emitLocalDisconnect();
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

  class StatusHandler {
    private password_sent = false;

    public constructor(private client: any) {
      client.on("error", (err) => {
        console.log(`Error in websocket connection: ${err.message}`);
        status_connected = false;
        client.terminate();
        client.removeAllListeners();
      });
      client.on("close", () => {
        console.log("Status disconnected");
        status_connected = false;
        client.removeAllListeners();
      });
      client.on("message", async (message) => {
        console.log(message);
        // Expect the password to be a plaintext string. We'll depend
        // on SSL for the encryption. Security? :(
        if (!this.password_sent) {
          if (message === process.env.LOCAL_PASSWORD) {
            console.log("Client gave correct password.");
            this.password_sent = true;
            client.send("ok");
          } else {
            console.log("Client gave invalid local password, disconnecting.");
            client.close();
            client.removeAllListeners();
            return;
          }
          status_emitter.addListener("remote_connect", () => {
            if (status_connected) {
              try {
                client.send(`{"type":"connect"}`);
              } catch (e) {
                console.log("Cannot send status update");
              }
            }
          });
          status_emitter.addListener("remote_disconnect", (name) => {
            if (status_connected) {
              try {
                client.send(`{"type":"disconnect"}`);
              } catch (e) {
                console.log("Cannot send status update");
              }
            }
          });
          // Bail before we start parsing JSON
          status_connected = true;
        }
      });
    }
  }

  app.ws("/status", (client, req) => {
    if (!forwarder_connected) {
      console.log("forwarder must connect before status endpoint connects.");
      client.close();
      return;
    }
    if (status_connected) {
      console.log("Status client already connected, disconnecting new client.");
      client.close();
      return;
    }
    const handler = new StatusHandler(client);
  });

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
        status_emitter.emitRemoteDisconnect();
        remote_connected = false;
      });
      status_emitter.addListener("local_disconnect", () => {
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
          if (m.Type === RequestServerInfo) {
            status_emitter.emitRemoteConnect();
          }
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

// If passwords have been found, actually set up endpoints and allow users to
// connect.
if (can_run) {
  run_app();
}
