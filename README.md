# Simple Teledildonics Web/Node App

This is a simple Teledildonics app, written in javascript and node. There are
two portions:

- A client, which runs in the browser
- A server, written in node.js and typescript, which runs on a server to connect
  local and remote instances.

This app is "simple" in that it is only meant to be used by 2 people at a time:
1 who is sharing their toys, and one who is controlling them.

**You must use Google Chrome or another blink based browser such as Microsoft
Edge or Brave (or in the case of iOS, the [WebBLE
browser](https://apps.apple.com/us/app/webble/id1193531073) will also work) if
you want to share your toys**. Remote control should work from any browser,
including firefox and safari, but that has only been tested in Firefox and
Chrome.

Please note that the UI of this app is not good, and is not meant for general
usage. This project was built to be a minimum possible implementation of remote
sex toy control with a very light amount of security and usability. It should be
considered a proof of concept and a base to build off of, rather than a finished
product.

Development and testing of this app took place on https://glitch.com, and all
recommendations in this manual will assume you are running there. This should
work on other hosted platforms, but you may need to edit code (for instance,
getting the passwords from the .env file) to change glitch features to work with
the platform you have chosen.

## How to use

There are two ways to use this app. You can share your own toys for control, or
you can control someone else's toys.

### Device Support

The list of toys this app works with can be found here:

https://iostindex.com/?filter0Availability=Available,DIY&filter1ButtplugSupport=2

Note that Gamepad Haptics should also work (for instance, xbox controllers on
windows), but you will need to connect them to your PC and press a button on the
controller, then hit "Start scanning", for them to be found.

### Sharing your own toys

If you want to share your own toys, you will first need your own instance of the
app. You should do this by "remixing" the project on glitch.com.

[https://glitch.com/edit/#!/qdot-simple-teledildonics-app](https://glitch.com/edit/#!/qdot-simple-teledildonics-app)

Once this is done:

- In the glitch editor, edit the .env file to add a local and remote password.
- Go to the app website. For instance, with the app above, that would be
  (https://qdot-simple-teledildonics-app.glitch.me)[https://qdot-simple-teledildonics-app.glitch.me].
  The domain name will be different for your remixed version.
- Enter the local password, and hit the Connect button.
- Hit "Start Scanning", and the WebBluetooth scan dialog should come up. Once it
  finds your toy, hit "Connect"
- Your toy should show up in the list, with controls. If you would like to share
  it for remote control, click the "Share Device" checkbox.

### Controlling someone else's toys

There are 2 ways to establish connections and control someone else's hardware.

To do either, you will first need to know:

- Their app domain (for instance, in the shared toys example above, that would
  be qdot-simple-teledildonics.glitch.me)
- Their remote password (which they will need to share with you somehow)

Once you have these, there are two ways to connect:

- Via their instance, which you can access from their domain. The "Remote
  Domain" box will autofill with the required value.
- Via your own instance, by putting their domain in the "Remote Domain" field.

In either case, after you have entered the remote domain and password, "Connect
to remote instance" and you should be connected. As devices are shared with you,
their controls will show up on your side and you can use them to change device
settings.

If the person you are controlling disconnects from the app, you will also be
disconnected.

## FAQ

- Why doesn't this work with [Intiface Desktop](https://intiface.com/desktop)?
  - Mostly laziness on the part of the developer. Adding the extra Intiface
    connection UI would confuse things even more at the moment, and this is
    supposed to be a demo app. An "advanced" version of the app that is not
    meant as a demo is in the works, and will have Intiface Desktop
    capabilities.
- What security is there?
  - Not much. The password system exists solely to limit access to the
    app. The app has 2 passwords which are stored in a plaintext file,
    and it is assumed these passwords will be transported via SSL, so
    we depend on TLS for our encryption. No limiters are built-in on
    the server side, so things like command flooding are a definite
    possibility. While some string validation is in place, the
    Buttplug library itself could also use more escaping and
    validators, as it currently contains very few, mostly checked via
    JSON schema. **Use at your own risk, and don't post your app
    domain publicly.**
- What is needed to run this outside of glitch?
  - If you want to run this app yourself, you will need your own server, and a
    domain with SSL capabilties. The project is meant to run with SSL only,
    otherwise passwords will go over the network in plaintext and WebBluetooth
    will not work. The only time this app should be run without SSL is if you're
    testing on localhost.
