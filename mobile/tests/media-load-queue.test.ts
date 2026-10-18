import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MediaLoadQueue } from '../src/services/mediaLoadQueue';

const tick = () => new Promise(resolve => setTimeout(resolve, 0));
test('binary downloads have bounded concurrency and canceled queued media never starts', async () => {
  const queue = new MediaLoadQueue(2);
  const controllers = Array.from({ length: 5 }, () => new AbortController());
  const releases: (() => void)[] = [];
  let active = 0, maximum = 0, started = 0;
  const jobs = controllers.map(controller => queue.run(async () => {
    started++; active++; maximum = Math.max(maximum, active);
    await new Promise<void>(resolve => releases.push(resolve));
    active--; return started;
  }, controller.signal));
  const canceled = assert.rejects(jobs[2], { name: 'AbortError' });
  await tick();
  assert.equal(started, 2);
  controllers[2].abort(); await canceled;
  // An in-flight native transfer cannot be canceled at the bridge. Its slot
  // remains occupied even when the screen/account has already discarded it.
  controllers[0].abort(); await tick();
  assert.equal(started, 2);
  releases.shift()!(); await tick();
  assert.equal(started, 3);
  releases.shift()!(); await tick();
  assert.equal(started, 4);
  releases.splice(0).forEach(release => release());
  await Promise.all([jobs[0], jobs[1], jobs[3], jobs[4]]);
  assert.equal(maximum, 2); assert.equal(started, 4);
});

test('media queue recovers after errors and refuses already canceled work', async () => {
  const queue = new MediaLoadQueue(1), controller = new AbortController();
  await assert.rejects(queue.run(async () => { throw new Error('fallo'); }, controller.signal), /fallo/);
  assert.equal(await queue.run(async () => 'ok', controller.signal), 'ok');
  controller.abort();
  await assert.rejects(queue.run(async () => { throw new Error('must not run'); }, controller.signal), { name: 'AbortError' });
  assert.throws(() => new MediaLoadQueue(0));
});
