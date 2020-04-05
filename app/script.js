///////////////////////////////////////
// UI Functions
///////////////////////////////////////

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
  slider.addEventListener("mouseup", async function (ev) {
    await device.SendVibrateCmd(slider.value / 100.0);
  });
  const stop_button = document.getElementById(`${control_id}-stop`);
  stop_button.addEventListener("click", async() => device.SendStopDeviceCmd());
}

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
  slider.addEventListener("mouseup", async function (ev) {
    await device.SendRotateCmd(Math.abs(slider.value / 100.0), slider.value < 0);
  });
  const stop_button = document.getElementById(`${control_id}-stop`);
  stop_button.addEventListener("click", async() => device.SendStopDeviceCmd());
}

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

  const run_oscillate = async (goto_max) => {
    if (!checkbox.checked) return;
    if (goto_max) {
      await device.SendLinearCmd(max_slider.value / 100.0, parseInt(duration_slider.value, 10));
    } else {
      await device.SendLinearCmd(min_slider.value / 100.0, parseInt(duration_slider.value, 10));
    }
    setTimeout(() => run_oscillate(!goto_max), duration_slider.value)
  };
  checkbox.addEventListener("mouseup", () => {
    if (checkbox.checked) run_oscillate(true);
  });
}

function create_device_controls_div(container, device, can_share = false, forwarder = undefined) {
  console.log(`${device.Name} connected!`);
  const device_div = document.createElement("div");
  const device_title = document.createElement("h2");
  device_title.innerHTML = device.Name;
  device_div.appendChild(device_title);
  device_div.id = `device-${device.Index}`;

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

function set_local_error(msg) {
  const error = document.getElementById("local-error");
  error.style.display = "block";
  error.innerHTML = msg;
}

function reset_local_error() {
  const error = document.getElementById("local-error");
  error.style.display = "none";
}

function set_remote_error(msg) {
  const error = document.getElementById("remote-error");
  error.style.display = "block";
  error.innerHTML = msg;
}

function reset_remote_error() {
  const error = document.getElementById("remote-error");
  error.style.display = "none";
}
///////////////////////////////////////
// Generic Connector Setup
///////////////////////////////////////

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

///////////////////////////////////////
// Local Connector
///////////////////////////////////////

class ButtplugClientForwarderBrowserWebsocketPasswordConnector extends Buttplug.ButtplugClientForwarderBrowserWebsocketConnector {
  constructor(host) {
    super(host);
    console.log("creating connector?!");
    this.Initialize = async () => {
      let res;
      let rej;
      const p = new Promise((rs, rj) => { res = rs; rej = rj; });
      function throwConnectError() {
        set_local_error("Incorrect password, or connection already established by another client. Please try again.");
      }
      const msgHandler = (ev) => {
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
      this._ws.addEventListener("close", throwConnectError);
      this._ws.addEventListener("message", msgHandler);
      this._ws.send(document.getElementById("local-password").value);
      console.log("Waiting for password return");
      try {
        await p;
      } finally {
        this._ws.removeEventListener("message", msgHandler);
      }
    }
  }
}

// Start Scanning Button Click Event Handler
const startLocalConnection = async function () {
  reset_local_error();
  const client = new Buttplug.ButtplugClient("Teledildonics 101 Client");
  const fconnector = new ButtplugClientForwarderBrowserWebsocketPasswordConnector("wss://" + window.location.hostname + "/forwarder");
  const forwarder = new Buttplug.ButtplugClientForwarder("Forwarder connector", fconnector);
  await forwarder.Connect();
  const container = document.getElementById("local-device-list");
  const connector = new Buttplug.ButtplugEmbeddedClientConnector();

  const button = document.getElementById("buttplug-local-button");
  button.addEventListener("click", async () => {
    await client.StartScanning();
  })

  await setup_client(client, connector, container, true, forwarder);
}

///////////////////////////////////////
// Remote Connector
///////////////////////////////////////

class ButtplugBrowserWebsocketClientPasswordConnector extends Buttplug.ButtplugBrowserWebsocketClientConnector {
  constructor(host) {
    super(host);
    console.log("creating connector?!");
    this.Initialize = async () => {
      console.log("Connecting using derived class?!");
      console.log(this);
      let res;
      let rej;
      const p = new Promise((rs, rj) => { res = rs; rej = rj; });
      function throwConnectError() {
        set_remote_error("Incorrect password, local side not ready, or remote connection already established by another client. Please try again.");
      }
      const msgHandler = (ev) => {
        if (ev.data === "ok") {
          console.log("Got correct password return");
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

// Start Scanning Button Click Event Handler
const startRemoteConnection = async function () {
  reset_remote_error();
  const client = new Buttplug.ButtplugClient("Teledildonics 101 Client");
  const container = document.getElementById("remote-device-list");
  const domain = document.getElementById("remote-domain");
  const connector = new ButtplugBrowserWebsocketClientPasswordConnector("wss://" + domain.value + "/");

  client.addListener("disconnect", () => {
    document.getElementById("remote-connect").style.display = "block";
    document.getElementById("remote-disconnect").style.display = "none";
  });

  await setup_client(client, connector, container);
  document.getElementById("remote-connect").style.display = "none";
  document.getElementById("remote-disconnect").style.display = "block";
}

if (navigator.bluetooth === undefined) {
  document.getElementById("local-no-bluetooth").style.display = "block";
  document.getElementById("local-ident").style.display = "none";
  document.getElementById("local-control").style.display = "none";
} else {
  document.getElementById("local-no-bluetooth").style.display = "none";
}