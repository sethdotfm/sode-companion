DISCLOSURE: This was written by an LLM.

# Sode Companion

A Bitfocus Companion connection module that runs one Sode panel on Companion buttons, such as a Stream Deck, plus a Generator that writes the Companion page for it. It uses only Sode's documented `/api/v1`.

Companion's help text for the module is in [companion/HELP.md](companion/HELP.md). Terms such as Surface, Connection and Generator are defined in [GLOSSARY.md](GLOSSARY.md).

## Setup, in order

1. **Turn on the API in Sode.** The API is off until an administrator enables it in Sode's settings.
2. **Make the panel act as its own API client.** In the Sode panel editor, switch the panel from acting as a user to acting as its own API client. The module refuses a panel that acts as a user.
3. **Make an instance key.** Create it on the panel's API client. Sode shows the key once. Sode links show it without the `sode_` prefix, and the module adds the prefix if it is missing, so either form works.
4. **Add the Connection in Companion.** Install the package (see below), add a "Sode panels" connection, and fill in the host, port, TLS choice, panel id or short name, instance key and optional device name. The device name is the instance name Sode shows and defaults to the connection's label.
5. **Run the Generator and import the page.** Put the key in the `SODE_KEY` environment variable and run:

   ```sh
   SODE_KEY=<key> npm run generate -- --host <host> --panel <panel> --label <connection label>
   ```

   It writes `<panel short name>.companionconfig`. Import that file in Companion as a page. Other options are `--port` (default 8080), `--tls`, `--connection-id` and `--out`.

## Key hygiene

Never paste a key into chat or commit it. The Generator and the tests read the key from the environment or a gitignored local file, and nothing prints it. The Connection stores it as a Companion secret. If a key leaks, revoke it in Sode and make a new one.

## Known limits

- One panel per connection. Two independent surfaces need two connections with two device names.
- No paging. A panel larger than the Companion grid shows the key squares inside the grid from the top left and ignores the rest.
- Needs Companion 5.1 or later.
- Only a panel's API client instance key works. Panels that act as a user are not supported.

## Install the package

```sh
npm ci
npm run package
```

This writes `sode-panels-<version>.tgz` in the repo root. In Companion, import it as a module package from the file. The package holds the bundled module, its manifest, `companion/HELP.md` and a license file. It holds no tests, fixtures or keys.

## Development

| Script | What it does |
| --- | --- |
| `npm test` | Runs the tests with `node --test` against a fake Sode. |
| `npm run lint` | Runs ESLint with Companion's config and Prettier. |
| `npm run check` | Runs `companion-module-check` on the manifest and package metadata. |
| `npm run build` | Builds the `.tgz` with `companion-module-build`. `npm run package` does the same. |
| `npm run link-dev -- <folder>` | Symlinks the repo into Companion's developer modules folder as `sode-panels`. |
| `npm run sync-model` | Refreshes the vendored copy of Sode's panel state model and records its source commit. |
| `npm run generate` | Runs the Generator. |

Keep `src/vendor` in step with Sode's `integration/panels` branch while panels are alpha. See [AGENTS.md](AGENTS.md).

## Verification status

The `.tgz` builds and passes `companion-module-check`. Loading it in Companion 5.1.2 from the file has not been checked here and needs a person to confirm.
