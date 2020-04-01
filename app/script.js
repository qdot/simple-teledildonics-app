// Global Setup
const client = new Buttplug.ButtplugClient("Teledildonics 101 Client");
const fconnector = new Buttplug.ButtplugClientForwarderBrowserWebsocketConnector("wss://" + window.location.hostname + "/forwarder");
const forwarder = new Buttplug.ButtplugClientForwarder("Forwarder connector", fconnector);
forwarder.Connect().then(() => console.log("Forwarder connected."));
const container = document.getElementById("device-list");

function create_vibration_controller(device_div, device) {
  const control_div = document.createElement("div");
  const control_id = `vibrate-${device.Index}`;
  control_div.innerHTML = `<h3>
    Vibrate
  </h3>
  <div>
  <input type="checkbox" id="${control_id}-share" />
  <label for="${control_id}-share" />Share Control</label>
  </div>
  <input type="range" min="0" max="100" value="0" id="${control_id}" />
  <label for="${control_id}">Vibration Speed</label>`;
  device_div.appendChild(control_div);
  const checkbox = document.getElementById(`${control_id}-share`);
  checkbox.addEventListener("click", (ev) => {
    if (checkbox.checked) {
      forwarder.AddDevice(device).then(() => console.log("Device shared"));
    } else {
      forwarder.RemoveDevice(device).then(() => console.log("Device unshared"));
    }
  });
  const slider = document.getElementById(control_id);
  slider.addEventListener("input", async function(ev) {
    await device.SendVibrateCmd(slider.value / 100.0);
  });
}

function create_rotation_controller(device_div, device) {
  const control_div = document.createElement("div");
  const control_id = `rotate-${device.Index}`;
  control_div.innerHTML = `<h3>
    Rotate
  </h3>
  <input type="range" min="-100" max="100" value="0" id="${control_id}" />
  <label for="${control_id}">Rotation Speed</label>`;
  device_div.appendChild(control_div);
  const slider = document.getElementById(control_id);
  slider.addEventListener("input", async function(ev) {
    await device.SendRotateCmd(Math.abs(slider.value / 100.0), slider.value < 0);
  });
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
  checkbox.addEventListener("click", () => {
    if (checkbox.checked) run_oscillate(true);
  });


}

// Start Scanning Button Click Event Handler
const startLocalConnection = async function() {
  client.addListener('deviceadded', async (device) => {
    console.log(`${device.Name} connected!`);
    const device_div = document.createElement("div");
    const device_title = document.createElement("h2");
    device_title.innerHTML = device.Name;
    device_div.appendChild(device_title);
    device_div.id = `device-${device.Index}`;
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
  });

  client.addListener('deviceremoved', (device) => {
    const device_div = document.getElementById(`device-${device.Index}`);
    container.removeChild(device_div);
  });

  const connector = new Buttplug.ButtplugEmbeddedClientConnector();
  await client.Connect(connector);
  console.log("Connected!");

  await client.StartScanning();
}
