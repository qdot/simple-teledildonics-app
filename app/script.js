////////////////////////////////////////////////////////////////////////////////
// UI Functions
////////////////////////////////////////////////////////////////////////////////

// Given a device that supports vibration, this creates the UI for controlling
// it. Includes:
//
// - A speed slider
// - A stop button
function create_vibration_controller(device_div, device) {
  const control_div = document.createElement("div");
  const control_id = `vibrate-${device.Index}`;
  control_div.innerHTML = `<h3>
    Vibrate
  </h3>
  <input type="range" min="0" max="100" value="0" id="${control_id}" />
  <label for="${control_id}">Vibration Speed</label><br />
  <button id="${control_id}-stop">Stop Vibration</button>`;
  device_div.appendChild(control_div);
  const slider = document.getElementById(control_id);

  // For all controls, we only send updates on the end of movement. Otherwise,
  // if the hardware is bluetooth, we'll flood the hardware with updates and it
  // won't be able to run all of the commands. This ends in either a bunch of
  // commands getting buffered and the hardware lags, or else a bunch of packets
  // getting dropped.
  //
  // We support both mouseup and touchend so that this will work on desktop and
  // mobile.
  slider.addEventListener("mouseup", async function (ev) {
    await device.SendVibrateCmd(slider.value / 100.0);
  });
  slider.addEventListener("touchend", async function (ev) {
    await device.SendVibrateCmd(slider.value / 100.0);
  });
  const stop_button = document.getElementById(`${control_id}-stop`);
  stop_button.addEventListener("click", async () => device.SendStopDeviceCmd());
}


// Given a device that supports rotation, this creates the UI for controlling
// it. Includes:
//
// - A speed slider, which can go positive/negative to change rotation direction
// - A stop button
function create_rotation_controller(device_div, device) {
  const control_div = document.createElement("div");
  const control_id = `rotate-${device.Index}`;
  control_div.innerHTML = `<h3>
    Rotate
  </h3>
  <input type="range" min="-100" max="100" value="0" id="${control_id}" />
  <label for="${control_id}">Rotation Speed</label><br />
  <button id="${control_id}-stop">Stop Rotation</button>`;
  device_div.appendChild(control_div);
  const slider = document.getElementById(control_id);

  // See Vibrate UI for explanation of this.
  slider.addEventListener("mouseup", async function (ev) {
    await device.SendRotateCmd(Math.abs(slider.value / 100.0), slider.value < 0);
  });
  slider.addEventListener("touchend", async function (ev) {
    await device.SendRotateCmd(Math.abs(slider.value / 100.0), slider.value < 0);
  });
  const stop_button = document.getElementById(`${control_id}-stop`);
  stop_button.addEventListener("click", async () => device.SendStopDeviceCmd());
}

// Given a device that supports linear movement, this creates the UI for
// controlling it. Includes:
//
// - Sliders for min position, max position, and movement duration
// - Oscillate checkbox
//
// Unlike vibrate/rotate, the oscillation option must be checked to get the
// device to move. When oscillate is checked, it will move the device back and
// forth between the min/max positions specified, over the duration of time
// given. Shorter duration = faster movement. Options can be changed while
// oscillation is happening.
function create_linear_controller(device_div, device) {
  const control_div = document.createElement("div");
  const control_id = `linear-${device.Index}`;
  control_div.innerHTML = `<h3>
    Linear
  </h3>
  <div>
    <input type="range" min="100" max="3000" value="1000" id="${control_id}-duration" />
    <label for="${control_id}-duration">Duration</label>
  </div>
  <div>
    <input type="range" min="0" max="100" value="0" id="${control_id}-min" />
    <label for="${control_id}-min">Min Position</label>
  </div>
  <div>
    <input type="range" min="0" max="100" value="0" id="${control_id}-max" />
    <label for="${control_id}-max">Max Position</label>
  </div>
  <input type="checkbox" id="${control_id}-oscillate" />
  <label for="${control_id}-oscillate">Oscillate</label>`;
  device_div.appendChild(control_div);
  const checkbox = document.getElementById(`${control_id}-oscillate`);
  const min_slider = document.getElementById(`${control_id}-min`);
  const max_slider = document.getElementById(`${control_id}-max`);
  const duration_slider = document.getElementById(`${control_id}-duration`);

  // To oscillate, we just create a setTimeout() call that's the length of the
  // duration. This will by no means be perfect (there may be pauses in
  // movement), because we're relying on the javascript vm for timing, but it's
  // good enough for this demo.
  const run_oscillate = async (goto_max) => {
    if (!checkbox.checked) return;
    if (goto_max) {
      await device.SendLinearCmd(max_slider.value / 100.0, parseInt(duration_slider.value, 10));
    } else {
      await device.SendLinearCmd(min_slider.value / 100.0, parseInt(duration_slider.value, 10));
    }
    setTimeout(() => run_oscillate(!goto_max), duration_slider.value)
  };
  checkbox.addEventListener("change", () => {
    if (checkbox.checked) run_oscillate(true);
  });
}

// Creates the base UI for a device when it has connected, for either the local
// or remote instance. Includes:
//
// - Device title
// - A share button if this is the local instance
// - UI for commands the device supports (vibrate, rotate, linear movement)
function create_device_controls_div(container, device, can_share = false, forwarder = undefined) {
  console.log(`${device.Name} connected!`);
  const device_div = document.createElement("div");
  const device_title = document.createElement("h2");
  device_title.innerHTML = validator.escape(device.Name);
  device_div.appendChild(device_title);
  device_div.id = `device-${device.Index}`;

  // Only allow sharing if this is the local device. Don't want remote users resharing!
  if (can_share) {
    const device_share_checkbox = document.createElement("input");
    device_share_checkbox.type = "checkbox";
    const device_share_checkbox_label = document.createElement("label");
    device_share_checkbox_label.for = device_share_checkbox;
    device_share_checkbox_label.innerHTML = "Share Control";
    device_div.appendChild(device_share_checkbox);
    device_div.appendChild(device_share_checkbox_label);

    device_share_checkbox.addEventListener("click", (ev) => {
      if (device_share_checkbox.checked) {
        forwarder.AddDevice(device).then(() => console.log("Device shared"));
      } else {
        forwarder.RemoveDevice(device).then(() => console.log("Device unshared"));
      }
    });
  }

  container.appendChild(device_div);

  // Parse the allowed messages and set up UI as required.
  if (device.AllowedMessages.includes("VibrateCmd")) {
    create_vibration_controller(device_div, device);
  }

  if (device.AllowedMessages.includes("RotateCmd")) {
    create_rotation_controller(device_div, device);
  }

  if (device.AllowedMessages.includes("LinearCmd")) {
    create_linear_controller(device_div, device);
  }
}

// Show an error on the sharer side UI
function set_local_error(msg) {
  const error = document.getElementById("local-error");
  error.style.display = "block";
  error.innerHTML = msg;
}

// Unset the error on the sharer side UI
function reset_local_error() {
  const error = document.getElementById("local-error");
  error.style.display = "none";
}

// Show an error on the controller side UI
function set_remote_error(msg) {
  const error = document.getElementById("remote-error");
  error.style.display = "block";
  error.innerHTML = msg;
}

// Unset the error on the controller side UI
function reset_remote_error() {
  const error = document.getElementById("remote-error");
  error.style.display = "none";
}

////////////////////////////////////////////////////////////////////////////////
// Generic Connector Setup
////////////////////////////////////////////////////////////////////////////////

// Function for setting up all of the events we need to listen to on a
// ButtplugClient, both on the sharer and controller sides. Takes the client and
// connector objects, as well as the div container to insert everything into.
// We'll set can_share to true and pass in the forwarder for the sharer.
async function setup_client(client, connector, container, can_share = false, forwarder = undefined) {
  client.addListener('deviceadded', async (device) => {
    create_device_controls_div(container, device, can_share, forwarder);
  });

  client.addListener('deviceremoved', (device) => {
    const device_div = document.getElementById(`device-${device.Index}`);
    container.removeChild(device_div);
  });

  client.addListener('disconnect', () => {
    for (const child of container.children) {
      container.removeChild(child);
    }
  });

  await client.Connect(connector);
  console.log("Connected!");
}

////////////////////////////////////////////////////////////////////////////////
// Local Connector
////////////////////////////////////////////////////////////////////////////////

// This is the client side of the device forwarder. The server side is in
// server.ts. As the extremely long typename describes, this uses a websocket to
// connect to the server side of the forwarder, and also authenticates itself
// with a password. The auth flow is documented in the server code. The only
// thing our child class does here is override the "Initialize" method. The
// super class calls Initialize as part of its "Connect" method, so we can put
// code in our Initialize to handle authentication.
class ButtplugClientForwarderBrowserWebsocketPasswordConnector extends Buttplug.ButtplugClientForwarderBrowserWebsocketConnector {
  constructor(host) {
    super(host);
    console.log("creating connector?!");
    this.Initialize = async () => {
      // We create a deconstructed promise in order to wait until auth is done
      // before we return from the Initialize function.
      let res;
      let rej;
      const p = new Promise((rs, rj) => { res = rs; rej = rj; });
      function throwConnectError() {
        set_local_error("Incorrect password, or connection already established by another client. Please try again.");
      }
      // The first message we get back should just be the string "ok". After
      // that, we should treat all incoming information as Buttplug messages,
      // which is handled by the library itself and hooked up as part of our
      // super class's Connect method.
      const msgHandler = (ev) => {
        // If we get back a string of "ok", we can clean up our authentication
        // hooks, update the UI, and start functioning.
        if (ev.data === "ok") {
          console.log("Got correct password return");
          document.getElementById("local-control").style.display = "block";
          document.getElementById("local-ident").style.display = "none";
          this._ws.removeEventListener("close", throwConnectError);
          this._ws.addEventListener("close", () => { console.log("socket closed"); });
          res();
          return;
        }
        console.log("Got failed password return");
        rej();
      };
      // If the socket closes, that means that either the password was wrong, or
      // someone is already connected. Write this error to the UI.
      this._ws.addEventListener("close", throwConnectError);
      // Check for the return string on the first message.
      this._ws.addEventListener("message", msgHandler);
      // Now that everything is hooked up, send over our password to the server.
      this._ws.send(document.getElementById("local-password").value);
      console.log("Waiting for password return");
      // Wait to get something back. No matter what, remove the msgHandler as an
      // event handler when we're done.
      try {
        await p;
      } finally {
        this._ws.removeEventListener("message", msgHandler);
      }
    }
  }
}

// Start Scanning Button Click Event Handler. Starts up the local connection,
// connecting us to:
//
// - The local buttplug server, so we can access hardware
// - The remote device forwarder, so we can share control of devices
// - The remote status endpoint, so we can know when someone has connected to
//   control our devices.
const startLocalConnection = async function () {
  // If there's any error showing in the UI, clear it.
  reset_local_error();

  // First, we'll set up the forwarder. Once again, since we assume we're
  // running on glitch, the server address should be the same as the address
  // that's hosting this script. So we just build off of that.
  const fconnector = new ButtplugClientForwarderBrowserWebsocketPasswordConnector("wss://" + window.location.hostname + (window.location.port ? ':' + window.location.port : '') + "/forwarder");
  const forwarder = new Buttplug.ButtplugClientForwarder("Forwarder connector", fconnector);
  await forwarder.Connect();

  // Now we set up our ButtplugClient. We just give it a generic name because
  // client name doesn't really matter here.
  const client = new Buttplug.ButtplugClient("Teledildonics 101 Client");
  // We'll use an embedded connector, so our Buttplug Server will exist within
  // our client.
  const connector = new Buttplug.ButtplugEmbeddedClientConnector();

  // Set up our device UI container so we can pass it to the setup function.
  const container = document.getElementById("local-device-list");

  // Take everything we've built so far, and make the UI for it.
  await setup_client(client, connector, container, true, forwarder);

  // Hook up the Start Scanning button to our client.
  const button = document.getElementById("buttplug-local-button");
  button.addEventListener("click", async () => {
    await client.StartScanning();
  })
  
  // Set up the status connection. This will tell us when a controller has
  // connected. Once again, it's expected to live on the same server that's
  // hosting this script.
  const status_ws = new WebSocket("wss://" + window.location.hostname + (window.location.port ? ':' + window.location.port : '') + "/status");
  status_ws.addEventListener("open", () => {
    status_ws.addEventListener("message", (ev) => {
      let msg = ev.data;
      // We do auth the same way as the forwarder. Send the password, expect
      // back "ok".
      if (msg === "ok") {
        console.log("password accepted, status endpoint running");
      } else {
        // If we've already sent the password, we'll only expect incoming
        // packets, nothing will be outgoing. So parse the json, and update the
        // UI appropriately based on the connector status we receive.
        const obj = JSON.parse(msg);
        console.log(msg);
        const coninfo = document.getElementById("local-connection-info");
        if (obj.type === "connect") {
          coninfo.style.color = "#0F0";
          coninfo.innerHTML = `Remote Connection Established`;
        } else if (obj.type === "disconnect") {
          coninfo.style.color = "#F00";
          coninfo.innerHTML = `Remote not connected.`;
        }
      }
    });

    // Now that we've set up all of our handlers, throw a password over. If it's
    // wrong, we'll be disconnected, but honestly we probably wouldn't get this
    // far in the first place because the forwarder connection would've thrown
    // and stopped us from getting here.
    status_ws.send(document.getElementById("local-password").value);
  });
}

// If we're in a browser without WebBluetooth, don't allow sharers to connect,
// because most of the hardware we support is bluetooth.
if (navigator.bluetooth === undefined) {
  document.getElementById("local-no-bluetooth").style.display = "block";
  document.getElementById("local-ident").style.display = "none";
  document.getElementById("local-control").style.display = "none";
} else {
  document.getElementById("local-no-bluetooth").style.display = "none";
}

////////////////////////////////////////////////////////////////////////////////
// Remote Connector
////////////////////////////////////////////////////////////////////////////////

// This is the connector we use to get the controller hooked up to the
// forwarder, so they can get access to shared devices. It looks a lot like the
// forwarder connector above, overriding the Initialize message of its super
// class to do password auth, then moving back to being a regular old Buttplug
// connector.
class ButtplugBrowserWebsocketClientPasswordConnector extends Buttplug.ButtplugBrowserWebsocketClientConnector {
  constructor(host) {
    super(host);
    this.Initialize = async () => {
      let res;
      let rej;
      const p = new Promise((rs, rj) => { res = rs; rej = rj; });
      function throwConnectError() {
        set_remote_error("Incorrect password, local side not ready, or remote connection already established by another client. Please try again.");
      }
      const msgHandler = (ev) => {
        if (ev.data === "ok") {
          document.getElementById("remote-ident").style.display = "none";
          this._ws.removeEventListener("close", throwConnectError);
          this._ws.addEventListener("close", () => { console.log("socket closed"); });
          res();
          return;
        }
        console.log("Got failed password return");
        rej();
      };
      this._ws.addEventListener("close", throwConnectError);
      this._ws.addEventListener("message", msgHandler);
      this._ws.send(document.getElementById("remote-password").value);
      console.log("Waiting for password return");
      try {
        await p;
      } finally {
        this._ws.removeEventListener("message", msgHandler);
      }
    }
  }
}

// Function run when Connect Remote button is pressed. 
const startRemoteConnection = async function () {
  reset_remote_error();
  const client = new Buttplug.ButtplugClient("Teledildonics 101 Client");
  const container = document.getElementById("remote-device-list");
  const domain = document.getElementById("remote-domain");
  // Unlike the sharer connection, which uses an embedded connector, the
  // controller wants to talk to a remote server. For this, we use the Browser
  // Websocket connector above.
  const connector = new ButtplugBrowserWebsocketClientPasswordConnector("wss://" + domain.value + "/");

  // Update UI based on whether we're connected or disconnected.
  client.addListener("disconnect", () => {
    set_remote_error("Remote side disconnected. Please try connecting again.");
    document.getElementById("remote-ident").style.display = "block";
    document.getElementById("remote-disconnect").style.display = "none";
  });

  await setup_client(client, connector, container);
  document.getElementById("remote-ident").style.display = "none";
  document.getElementById("remote-disconnect").style.display = "block";
}

// Default to the local domain as the remote, mostly for convenience.
document.getElementById("remote-domain").value = window.location.hostname + (window.location.port ? ':' + window.location.port : "");
