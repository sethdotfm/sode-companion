# Sode panels

Runs one Sode panel on Companion buttons. Pressing a button does what pressing that Cell does in the Sode web panel, and the buttons show the same names, colours and router state.

## Setup, in order

1. **Turn on the API in Sode.** The API is off until an administrator enables it in Sode's settings.
2. **Make the panel act as its own API client.** In the Sode panel editor, switch the panel from acting as a user to acting as its own API client. A panel that acts as a user is refused, and the connection status says so.
3. **Make an instance key.** Create it on the panel's API client. Sode shows the key once, so copy it then. Sode links show the key without the `sode_` prefix. The module adds the prefix when it is missing, so paste either form.
4. **Add the Connection in Companion.** Add a "Sode panels" connection and fill in the Sode host, port, TLS choice, the panel's id or short name, the instance key and, if you want a name other than the connection's label, the device name. Sode shows the device name as the instance name. The status turns Ok once the panel loads.
5. **Run the Generator and import the page.** In a checkout of this repository, run `npm run generate -- --rows 4 --cols 8 --label <connection label> --connection-id <id> --out page.companionconfig`. It writes a `.companionconfig` file without contacting Sode and without a key. Import that file in Companion as a page. Every button is bound to the connection and presses its own row and column, so the page fits any panel that is no larger than the grid. Rows and columns default to 4 and 8 and go up to 32. `--host`, `--port` and `--tls` fill in the connection's config.

## Key hygiene

Never paste a key into chat or commit it. The Connection holds it as a Companion secret, so it stays out of plain config exports. If a key leaks, revoke it in Sode and make a new one.

## What shows

- Pressing a Destination key views that destination. The viewed destination's current source is solid green.
- Pressing a Source or Preset key stages it. Staged Destination keys pulse orange and show the staged source.
- The Take key lights once something valid is staged. Take applies every staged change at once. Clear drops the view and the staged changes. After a take the destination stays viewed, so its Source keys and the Current Destination key keep showing its source. With the double-press guard, the Take key reads "Press Take again" for 1.5 seconds after the first press.
- A finger on the Take key hides its text. Turn on "Show Take messages on the route keys" in the connection settings (off by default) and "Keep holding" and "Press Take again" also show on the viewed Destination key and each staged Source key, in the Take key's colour, until the prompt ends. Results and refusals stay on the Take key. Saving the settings reconnects the panel.
- Every key shows Offline and ignores presses while Sode or the router is unreachable. The connection status then reads Connection Failure.

Variables hold the viewed destination, its current source, the staged count, the last error, the router status, and for each key square its text (`key_<row>_<col>`), background colour (`key_<row>_<col>_bg`) and text colour (`key_<row>_<col>_fg`). The colours are numbers (0xRRGGBB). Each square also has its Key picture (`key_<row>_<col>_pic`), the picture's opacity in percent (`_op`: 30 for a picture under a label, 100 once its text is hidden or with no picture), a `_inset` flag and Border widths (`_bl`, `_bt`, `_br`, `_bb`). Generated pages read these variables in layer expressions, so they carry no feedback. Presets and the Look feedback are for building buttons by hand.

## Known limits

- One panel per connection. Use two connections, with two device names, for two independent surfaces.
- No paging. A panel larger than the Companion grid shows the key squares that fall inside it from the top left, and ignores the rest.
- Needs Companion 5.1 or later.
- Only a panel's API client instance key works. User keys and panels that act as a user are not supported.
