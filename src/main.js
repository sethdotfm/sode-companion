// The Companion shell: config in, presets and looks out. Behaviour lives in runtime.js and surface.js.
import { InstanceBase, InstanceStatus } from '@companion-module/base';
import { createRuntime } from './runtime.js';
import { instanceStatusOf } from './companion-status.js';
import { createSurface, actionDefinitions, feedbackDefinitions } from './surface.js';

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
      { id: 'host', type: 'textinput', label: 'Sode host', width: 8, default: '', minLength: 1 },
      { id: 'port', type: 'number', label: 'Port', width: 4, default: 8080, min: 1, max: 65535 },
      { id: 'tls', type: 'checkbox', label: 'Use TLS (https)', width: 4, default: false },
      { id: 'panel', type: 'textinput', label: 'Panel id or short name', width: 8, default: '', minLength: 1 },
      { id: 'key', type: 'secret-text', label: 'Panel instance key', width: 12, minLength: 1 },
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
    const runtime = createRuntime({
      host: config.host,
      port: config.port,
      tls: !!config.tls,
      panel: config.panel,
      key: secrets?.key,
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
