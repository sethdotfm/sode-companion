import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRuntime } from '../src/runtime.js';
import { startFakeSode, panelOf, KEY } from './fake-sode.js';

const open = [];
afterEach(async () => {
  while (open.length) await open.pop()();
});

async function connect(cells, device = 'Deck') {
  const fake = await startFakeSode({ panel: panelOf(cells), tally: { levels: [{ level: 1, label: '1' }], routes: [] } });
  const rt = createRuntime({ host: '127.0.0.1', port: fake.port, panel: 'speedtest', key: KEY, device, pollMs: 15 });
  open.push(
    () => rt.stop(),
    () => fake.close(),
  );
  await rt.start();
  return { rt, fake };
}

test('Panel Name and Instance Name cells show the names, with the caption as a first line', async () => {
  const { rt, fake } = await connect([
    { r: 1, c: 1, kind: 'panelName' },
    { r: 1, c: 2, kind: 'instanceName' },
    { r: 2, c: 1, kind: 'panelName', caption: 'Panel' },
    { r: 2, c: 2, kind: 'instanceName', caption: 'Surface' },
  ]);
  const name = fake.panel.name;
  assert.equal(rt.look(1, 1).text, name);
  assert.equal(rt.look(1, 2).text, 'Deck');
  assert.equal(rt.look(2, 1).text, `Panel\n${name}`);
  assert.equal(rt.look(2, 2).text, 'Surface\nDeck');
  assert.equal(rt.look(1, 1).colour, 'panelName');
  assert.equal(rt.look(1, 2).colour, 'instanceName');
});

test('a name cell is not pressable', async () => {
  const { rt } = await connect([{ r: 1, c: 1, kind: 'panelName' }]);
  const before = rt.look(1, 1);
  await rt.press(1, 1);
  assert.deepEqual(rt.look(1, 1), before);
});
