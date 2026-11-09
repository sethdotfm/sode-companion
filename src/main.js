// The Companion shell: config in, presets and looks out. Behaviour lives in runtime.js.
import { InstanceBase, InstanceStatus } from '@companion-module/base';
import { createRuntime } from './runtime.js';
import { instanceStatusOf } from './companion-status.js';

const WHITE = 0xffffff;
// Muted idle colours per Cell kind. Source, Destination and press states come with the takes work.
// Pulse phases come with their own slice; a pulsing look shows its solid colour for now.
const COLOURS = {
  source: 0x1f3a5f,
  'source-current': 0x1f8f3f,
  'source-pending': 0x1f8f3f,
  destination: 0x5f3a1f,
  'destination-view': 0xb86a1f,
  'destination-staged': 0xe08a1f,
  take: 0x7a1f1f,
  'take-armed': 0xd02a2a,
  preset: 0x3a1f5f,
  clear: 0x444444,
  current: 0x1f5f5f,
  none: 0x000000,
};

class SodePanelsInstance extends InstanceBase {
  runtime = null;

  async init(config, _isFirstInit, secrets) {
    this.setVariableDefinitions({
      viewed: { name: 'Viewed destination' },
      current: { name: 'Current source of the viewed destination' },
      staged: { name: 'Staged route count' },
      error: { name: 'Last error' },
    });
    this.setActionDefinitions({
      press: {
        name: 'Press a panel key square',
        options: [
          { id: 'row', type: 'number', label: 'Row', default: 1, min: 1, max: 99 },
          { id: 'col', type: 'number', label: 'Column', default: 1, min: 1, max: 99 },
        ],
        callback: async ({ options }) => {
          await this.runtime?.press(options.row, options.col);
        },
      },
    });
    this.setFeedbackDefinitions({
      look: {
        type: 'advanced',
        name: 'Look of a panel key square',
        description: 'Text and colour of the Cell at this row and column of the panel.',
        options: [
          { id: 'row', type: 'number', label: 'Row', default: 1, min: 1, max: 99 },
          { id: 'col', type: 'number', label: 'Column', default: 1, min: 1, max: 99 },
        ],
        affectedProperties: ['text', 'color', 'bgcolor'],
        callback: ({ options }) => {
          const look = this.runtime?.look(options.row, options.col);
          return look ? { text: look.text, color: WHITE, bgcolor: COLOURS[look.colour] ?? COLOURS.none } : {};
        },
      },
    });
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
      device: (config.device || this.label).slice(0, 40),
      // Debug lines only: the runtime never logs a key.
      log: (line) => this.log('debug', line),
    });
    this.runtime = runtime;
    runtime.onChange(() => {
      if (this.runtime !== runtime) return;
      const { code, text } = runtime.status();
      this.updateStatus(instanceStatusOf(code) ?? InstanceStatus.UnknownError, text);
      if (code === 'ok') this.#presets();
      this.setVariableValues(runtime.variables());
      this.checkFeedbacks('look');
    });
    runtime.start();
  }

  #presets() {
    const presets = {};
    const ids = [];
    for (const cell of this.runtime.cells()) {
      const { text, colour } = this.runtime.look(cell.r, cell.c);
      const id = `cell_${cell.r}_${cell.c}`;
      ids.push(id);
      presets[id] = {
        type: 'simple',
        name: `Row ${cell.r} column ${cell.c}: ${text}`,
        style: { text, size: 'auto', color: WHITE, bgcolor: COLOURS[colour] },
        steps: [{ down: [{ actionId: 'press', options: { row: cell.r, col: cell.c } }], up: [] }],
        feedbacks: [{ feedbackId: 'look', options: { row: cell.r, col: cell.c } }],
      };
    }
    this.setPresetDefinitions([{ id: 'cells', name: 'Panel cells', definitions: ids }], presets);
  }
}

export default SodePanelsInstance;
export const UpgradeScripts = [];
