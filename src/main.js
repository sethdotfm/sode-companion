// The Companion shell: config in, presets and looks out. Behaviour lives in runtime.js and surface.js.
import { InstanceBase, InstanceStatus } from '@companion-module/base';
import { createRuntime } from './runtime.js';
import { instanceStatusOf } from './companion-status.js';
import { createSurface, actionDefinitions, feedbackDefinitions } from './surface.js';

// Keep in step with templates/, which test/template.test.js checks against the Generator.
const TEMPLATE_BASE = 'https://github.com/sethdotfm/sode-companion/raw/main/templates';
export const TEMPLATES = [
  { file: 'sode-4x8.companionconfig', rows: 4, cols: 8, text: 'Download the 4x8 button page' },
  { file: 'sode-2x16.companionconfig', rows: 2, cols: 16, text: 'Download the 2x16 button page (Stream Deck Studio)' },
];
export const GENERATOR_URL = 'https://sethdotfm.github.io/sode-companion/generator/';
const templateLinks = TEMPLATES.map((t) => `<a href="${TEMPLATE_BASE}/${t.file}" target="_blank" rel="noreferrer">${t.text}</a>`);

class SodePanelsInstance extends InstanceBase {
  runtime = null;

  async init(config, _isFirstInit, secrets) {
    this.setActionDefinitions(actionDefinitions(() => this.runtime));
    this.setFeedbackDefinitions(feedbackDefinitions(() => this.runtime));
    this.#connect(config, secrets);
  }

  async configUpdated(config, secrets) {
    this.#connect(config, secrets);
  }

  async destroy() {
    this.runtime?.stop();
    this.runtime = null;
  }

  getConfigFields() {
    return [
      {
        id: 'template',
        type: 'static-text',
        label: 'Button page',
        value: `${templateLinks.join(' or ')}, then import it in Companion and pick this connection when it asks. For another size, <a href="${GENERATOR_URL}" target="_blank" rel="noreferrer">make your own in the browser</a>.`,
        width: 12,
      },
      {
        id: 'link',
        type: 'secret-text',
        label: 'Sode link (optional)',
        tooltip: 'Paste the whole panel link from Sode. Its host, port, TLS, panel, key and instance name replace the fields below.',
        width: 12,
      },
      { id: 'host', type: 'textinput', label: 'Sode host', width: 8, default: '' },
      { id: 'port', type: 'number', label: 'Port', width: 4, default: 8080, min: 1, max: 65535 },
      { id: 'tls', type: 'checkbox', label: 'Use TLS (https)', width: 4, default: false },
      {
        id: 'insecureTls',
        type: 'checkbox',
        label: 'Accept a self-signed certificate',
        tooltip:
          'Skips the certificate check for this connection, for a dev Sode that serves its own certificate. Use it only on a network you trust.',
        width: 4,
        default: false,
      },
      { id: 'panel', type: 'textinput', label: 'Panel id or short name', width: 8, default: '' },
      { id: 'key', type: 'secret-text', label: 'Panel instance key (blank for a Public panel)', width: 12 },
      { id: 'device', type: 'textinput', label: 'Device name (blank uses the connection label)', width: 8, default: '' },
      {
        id: 'takeMessages',
        type: 'checkbox',
        label: 'Show Take messages on the route keys',
        tooltip:
          'Also shows "Keep holding" and "Press Take again" on the viewed Destination and the staged Sources, where a finger on the Take key hides them.',
        width: 12,
        default: false,
      },
    ];
  }

  #connect(config, secrets) {
    this.runtime?.stop();
    // Node reads this at connect time. Each Companion connection runs in its own process, so it affects only this one.
    if (config.insecureTls) process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    else delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    const runtime = createRuntime({
      host: config.host,
      port: config.port,
      tls: !!config.tls,
      panel: config.panel,
      key: secrets?.key,
      link: secrets?.link,
      device: config.device,
      takeMessages: !!config.takeMessages,
      label: this.label,
      // Debug lines only: the runtime never logs a key.
      log: (line) => this.log('debug', line),
    });
    this.runtime = runtime;
    const surface = createSurface({
      runtime,
      label: this.label,
      host: {
        updateStatus: (code, text) => this.updateStatus(instanceStatusOf(code) ?? InstanceStatus.UnknownError, text),
        setVariableDefinitions: (defs) => this.setVariableDefinitions(defs),
        setPresetDefinitions: (structure, presets) => this.setPresetDefinitions(structure, presets),
        setVariableValues: (values) => this.setVariableValues(values),
        checkFeedbacks: (id) => this.checkFeedbacks(id),
      },
    });
    runtime.onChange(() => {
      if (this.runtime === runtime) surface.sync();
    });
    runtime.start();
  }
}

export default SodePanelsInstance;
export const UpgradeScripts = [];
