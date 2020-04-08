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

// Endpoint setup and handling are wrapped in a function that we will only run
// if passwords are set up.
function run_app() {
  // Serve everything in the app directory.
  app.use(express.static(__dirname + "/app"));

  // We keep the device forwarder server as a global, because we need to set it
  // up when the local side connects, then have the remote side connect to it as
  // a client later. This requires it to be shared between endpoints.
  let server: ButtplugExpressWebsocketServer;

  // The /forwarder endpoint is how the sharer side of a connection actually
  // shares their devices. This uses a "forwarder", a structure in the buttplug
  // library can take a ButtplugClientDevice and forward it to another server to
  // make it look like it's owned by that server. Whenever a sharer connection
  // happens, it connects to this endpoint and when a device's "share device"
  // option is selected, it is forwarded through this so that a controller can
  // send commands through it. The commands come through the forwarder, and back
  // to the sharer's client. It looks something like this.
  //
  // Sharing a device:
  //
  // hardware device -> sharer buttplug server -> sharer buttplug client 
  // -> forwarder device manager -> controller server -> controller client
  //
  // Sending a command to a shared device traverses this chain in the opposite
  // direction.
  app.ws('/forwarder', (client, req) => {
    console.log("Got client connection for forwarder");
    // We can only have one connection to the forwarder at a time here. A single
    // forwarder could actually handle multiple sharers (meaning one controller
    // could control multiple sharer's toys from the same interface), but we
    // keep it to one here to keep things simple.
    if (forwarder_connected) {
      console.log("Someone tried to connect while we already have a connection. Connection closed.");
      client.close();
      return;
    }

    // Set up the forwarder and server. First, we have to create a forwarder
    // connector, which uses a websocket to listen for forwarder commands
    // (AddDevice, RemoveDevice), and sends device commands from the controller
    // back to the client that is connected to the forwarder. This connector
    // class is defined below, so in-depth explanation will happen there.
    let connector: ButtplugServerForwardedNodeWebsocketConnector;
    connector = new ButtplugServerForwardedNodeWebsocketConnector(client);
    console.log("Starting forwarder listener...");
    connector.Listen();

    // Now we set up the server that will host forwarded devices.
    server = new ButtplugExpressWebsocketServer("Remote Server", 0);
    
    // Forwarded devices use a "device communication manager", which is another
    // common structure in Buttplug. Device communication managers handle a
    // certain class of devices: bluetooth devices, USB devices, etc... The
    // forwarded device manager doesn't manage actual hardware, but instead
    // manages proxies to devices running in other buttplug instances.
    const fdm = new ForwardedDeviceManager(undefined, connector);
    server.AddDeviceManager(fdm);
    console.log("Starting server...");
  });

  // ButtplugServerForwardedConnectors are what the ForwardedDeviceManager
  // mentioned above uses to receive proxied devices. For this specific example,
  // it will listen on a websocket, but we can proxy over any network or IPC
  // connection.
  //
  // This will also handle some of our security, as the sharer password exchange
  // happens here.
  class ButtplugServerForwardedNodeWebsocketConnector extends EventEmitter implements ButtplugServerForwardedConnector {

    public constructor(private wsClient: any) {
      super();
    }

    // We'll never want this to disconnect on the connector end. It should stay
    // connected for the lifetime of the sharer's session.
    public Disconnect = (): Promise<void> => {
      return Promise.resolve();
    }

    // Send a message to the sharer.
    public SendMessage = (msg: ButtplugMessage): Promise<void> => {
      this.wsClient.send("[" + msg.toJSON() + "]");
      return Promise.resolve();
    }

    // The name here is a bit misleading, as since we're using expressWs, the
    // listener is set up earlier. However, since this is expected to a server,
    // we have to fill this in anyways, so we use this as a chance to set up the
    // websocket client we've received.
    public Listen = (): Promise<void> => {

      // This will be set to true once the password exchange has happened. See
      // the "message" event handler for more info.
      let password_sent = false;
      
      // If the websocket errors out for some reason, just terminate connection.
      this.wsClient.on("error", (err) => {
        console.log(`Error in websocket connection: ${err.message}`);
        forwarder_connected = false;
        status_emitter.emitLocalDisconnect();
        this.wsClient.terminate();
        this.wsClient.removeAllListeners();
        this.emit("disconnect");
      });

      // If the websocket closes, we want to update our status so another sharer
      // can connect (or the same one can reconnect), then let the rest of the
      // system know that the sharer disconnected, so we can do things like
      // kicking the controller out too.
      this.wsClient.on("close", () => {
        console.log("Local side disconnected");
        forwarder_connected = false;
        status_emitter.emitLocalDisconnect();
        this.wsClient.removeAllListeners();
        this.emit("disconnect");
      });

      // If we get a message, a couple of things can happen, so just keep
      // reading the internal comments.
      this.wsClient.on("message", async (message) => {
        // The first thing we'll get in a connection is the password. If it
        // doesn't match what we expect, we just close the connection.
        //
        // Expect the password to be a plaintext string. We'll depend on SSL for
        // the encryption here. If you run this over unencrypted links, you
        // might want to fix this. But please, don't do that.
        if (!password_sent) {
          if (message === process.env.LOCAL_PASSWORD) {
            console.log("Client gave correct password.");
            // We got the correct password, so we can bypass the check from now
            // on.
            password_sent = true;
            // If the password is correct, we just send back "ok". From here on
            // out, everything is expected to be Buttplug Protocol JSON
            // messages.
            this.wsClient.send("ok");
          } else {
            console.log("Client gave invalid local password, disconnecting.");
            this.wsClient.close();
            this.wsClient.removeAllListeners();
            return;
          }
          // Set our sharer connected status, then bail before we start parsing
          // JSON
          forwarder_connected = true;
          return;
        }

        // If we've already gotten the password, we expect that we're getting a
        // JSON array of Buttplug messages. Convert it from JSON to a message
        // object array and emit one-by-one. 
        const msg = FromJSON(message);
        for (const m of msg) {
          console.log(m);
          this.emit("message", m);
        }
      });
      // This function can sometimes be async. Now is not one of those times.
      return Promise.resolve();
    }
  }

  // We need a way to tell the sharer when a controller has connected, so they
  // can know to expect possible control changes with their hardware.
  // Unfortunately, every other connection in the server is tied to the Buttplug
  // protocol, which has no way to encode this information. Therefore, we just
  // make another endpoint specifically for this purpose.
  class StatusHandler {
    // Set to true once authorization has happened.
    private password_sent = false;

    public constructor(private client: any) {
      // If we error, bail.
      client.on("error", (err) => {
        console.log(`Error in websocket connection: ${err.message}`);
        status_connected = false;
        client.terminate();
        client.removeAllListeners();
      });
      // If we close, clear out connection status and bail. This will usually
      // only happen when the sharer disconnects from everything.
      client.on("close", () => {
        console.log("Status disconnected");
        status_connected = false;
        client.removeAllListeners();
      });
      // 
      client.on("message", async (message) => {
        // This is the same flow as the ButtplugServerForwarderConnector. Only
        // the sharer should be able to access the status endpoint, so we run
        // the password auth here too.
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
          // If the controller connects or disconnects, relay that info to the
          // sharer so the UI will update. Just use an arbitrary JSON format for
          // now.
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
          // We should only have one connection to the status endpoint at a
          // time.
          status_connected = true;
        }
      });
    }
  }

  // Set up the status endpoint. The sharer must already be connected, and there
  // should be no connections to the status endpoint yet.
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

  // Set up the controller connection endpoint. This will forwarded shared
  // devices to the controller so they can access them.
  app.ws('/', (client, req) => {
    // The controller can only connect after the sharer has connected. Not a
    // requirement, just seems like a flow that makes more sense.
    if (!forwarder_connected) {
      console.log("Remote client disconnected because local client not active.");
      client.close();
      return;
    }
    // We can only have one controller connected at a time.
    if (remote_connected) {
      console.log("Remote client already connected, disconnecting new client.");
      client.close();
      return;
    }

    // Set this websocket client up to talk to the forwarded device server.
    server.InitServer(client);
  });

  // Unlike Buttplug Clients and their "Connector" classes, for exposing servers
  // we usually wrap the ButtplugServer object somehow. Since we have
  // inheritance in Typescript/Javascript, we'll use that.
  class ButtplugExpressWebsocketServer extends ButtplugServer {
    public constructor(name: string, maxPingTime: number = 0) {
      super(name, maxPingTime);
    }

    public get IsRunning(): boolean {
      return true;
    }

    // Shuts down the server, closing all connections.
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
