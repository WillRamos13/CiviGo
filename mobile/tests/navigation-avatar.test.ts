import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AvatarPicker, NavigationAvatarIcon } from '../src/components/map/NavigationAvatar';
import { NavigationAvatarPreferenceController, NAVIGATION_AVATARS, isNavigationAvatar, navigationAvatarRotation,
  updateNavigationAvatarMarker, navigationAvatarLabel, type NavigationAvatarPreferences } from '../src/services/navigationAvatar';

function driver() {
  const values = new Map<string, string>(), calls: string[] = [];
  return { values, calls,
    async get({ key }: { key: string }) { calls.push(`get:${key}`); return { value: values.get(key) ?? null }; },
    async set({ key, value }: { key: string; value: string }) { calls.push(`set:${key}`); values.set(key, value); },
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test('avatar preferences isolate accounts, validate input and never persist a guest selection', async () => {
  const store = driver(), controller = new NavigationAvatarPreferenceController(store);
  assert.equal(await controller.load(), null);
  assert.equal(await controller.save('car'), false);
  assert.equal(store.calls.length, 0);
  controller.setOwner(17);
  assert.equal(await controller.load(), 'arrow');
  assert.equal(await controller.save('car'), true);
  assert.equal(await controller.load(), 'car');
  controller.setOwner(18);
  assert.equal(await controller.load(), 'arrow');
  assert.equal(await controller.save('bicycle'), true);
  controller.setOwner(17);
  assert.equal(await controller.load(), 'car');
  assert.equal(store.values.get('civigo:navigation-avatar:v1:user:18'), 'bicycle');
  await assert.rejects(() => controller.save('<script>' as any), /válido/);
  for (const owner of [null, -1, NaN, 1.5]) {
    controller.setOwner(owner);
    assert.equal(await controller.load(), null);
    assert.equal(await controller.save('walking'), false);
  }
});

test('a delayed read cannot overwrite a new selection or cross an account switch', async () => {
  const read = deferred<{ value: string | null }>(), store = driver();
  let first = true;
  const preferences: NavigationAvatarPreferences = { ...store, get: async options => {
    if (first) { first = false; return read.promise; }
    return store.get(options);
  } };
  const controller = new NavigationAvatarPreferenceController(preferences);
  controller.setOwner(1);
  const oldRead = controller.load();
  await Promise.resolve();
  const selected = controller.save('motorcycle');
  read.resolve({ value: 'car' });
  assert.equal(await oldRead, null);
  assert.equal(await selected, true);
  assert.equal(await controller.load(), 'motorcycle');
  const pending = deferred<{ value: string | null }>();
  preferences.get = async () => pending.promise;
  const accountRead = controller.load();
  await Promise.resolve();
  controller.setOwner(2);
  pending.resolve({ value: 'car' });
  assert.equal(await accountRead, null);
});

test('preference writes serialize across remounts and queued writes cannot follow the old account', async () => {
  const blocked = deferred<void>(), store = driver();
  let first = true;
  const preferences: NavigationAvatarPreferences = { ...store, set: async options => {
    if (first) { first = false; await blocked.promise; }
    await store.set(options);
  } };
  const oldController = new NavigationAvatarPreferenceController(preferences);
  oldController.setOwner(1);
  const oldWrite = oldController.save('car');
  await Promise.resolve();
  const remounted = new NavigationAvatarPreferenceController(preferences);
  remounted.setOwner(1);
  const latest = remounted.save('walking');
  oldController.setOwner(null);
  assert.equal(store.values.size, 0);
  blocked.resolve();
  assert.equal(await oldWrite, false);
  assert.equal(await latest, true);
  assert.equal(await remounted.load(), 'walking');
  const skipped = remounted.save('bicycle');
  remounted.setOwner(2);
  assert.equal(await skipped, false);
  assert.equal(store.values.get('civigo:navigation-avatar:v1:user:1'), 'walking');
});

test('an obsolete storage failure is ignored and the shared queue recovers for the next account', async () => {
  const read = deferred<{ value: string | null }>(), store = driver();
  const preferences: NavigationAvatarPreferences = { ...store, get: async () => read.promise };
  const controller = new NavigationAvatarPreferenceController(preferences);
  controller.setOwner(1);
  const old = controller.load(); await Promise.resolve();
  controller.setOwner(2);
  read.reject(new Error('Old storage failure'));
  assert.equal(await old, null);
  preferences.get = options => store.get(options);
  assert.equal(await controller.save('bicycle'), true);
  assert.equal(await controller.load(), 'bicycle');
});

test('accessible vehicle models and legacy avatars use distinct trusted local vectors', () => {
  const vectors = NAVIGATION_AVATARS.map(option => renderToStaticMarkup(React.createElement(NavigationAvatarIcon, { avatar: option.id })));
  assert.equal(new Set(vectors).size, NAVIGATION_AVATARS.length);
  assert.ok(vectors.every(svg => svg.includes('viewBox="0 0 40 40"') && !/<(?:script|image|foreignObject)|href=|onload=|url\(/i.test(svg)));
  assert.equal(isNavigationAvatar('car'), true);
  assert.equal(isNavigationAvatar('CAR'), false);
  const picker = renderToStaticMarkup(React.createElement(AvatarPicker, { value: 'car', onChange() {} }));
  assert.match(picker, /role="radiogroup" aria-label="Icono de navegación"/);
  assert.equal((picker.match(/role="radio"/g) ?? []).length, 5);
  assert.equal((picker.match(/aria-checked="true"/g) ?? []).length, 1);
  for (const option of NAVIGATION_AVATARS.filter(item=>['arrow','car','motorcycle','bicycle','walking'].includes(item.id))) assert.ok(picker.includes(option.label));
});

test('vehicle model and color are real local SVG choices, persist per account and never change transport', async () => {
  const store = driver(), controller = new NavigationAvatarPreferenceController(store);
  controller.setOwner(17);
  assert.equal(await controller.save('suv:red'), true);
  assert.equal(await controller.load(), 'suv:red');
  for (const invalid of ['suv:#ffffff', 'suv:red:', 'sport:red:script', 'car:yellow', 'https://image.test', 'compact:purple']) assert.equal(isNavigationAvatar(invalid), false);
  const red = renderToStaticMarkup(React.createElement(NavigationAvatarIcon, { avatar: 'suv:red' }));
  const blue = renderToStaticMarkup(React.createElement(NavigationAvatarIcon, { avatar: 'suv:blue' }));
  assert.notEqual(red, blue); assert.match(red, /#ef4848/);
  assert.equal(navigationAvatarLabel('sport:silver'), 'Deportivo · Plata');
  const picker = renderToStaticMarkup(React.createElement(AvatarPicker, { value: 'suv:red', onChange() {} }));
  assert.match(picker, /Color del vehículo/); assert.match(picker, /El icono no cambia tu transporte/);
  assert.equal((picker.match(/aria-pressed="true"/g) ?? []).length, 1);
});

test('avatar heading subtracts map bearing and rejects unavailable sensor headings', () => {
  assert.equal(navigationAvatarRotation(90, 30), 60);
  assert.equal(navigationAvatarRotation(10, 350), 20);
  assert.equal(navigationAvatarRotation(350, 10), -20);
  assert.equal(navigationAvatarRotation(-1, 0), 0);
  assert.equal(navigationAvatarRotation(NaN, undefined), 0);
  assert.equal(navigationAvatarRotation(720, 0), 0);
});

test('changing a vehicle rotates only its inner graphic and preserves the Mapbox anchor', () => {
  class Element {
    dataset: Record<string, string> = {};
    attrs: Record<string, string> = {};
    style: Record<string, string> = {};
    children: Element[] = [];
    className = '';
    classList = { add: (name: string) => { this.className += ` ${name}`; } };
    ownerDocument: any;
    constructor(public tag: string) { this.ownerDocument = { createElement: (tag: string) => new Element(tag), createElementNS: (_: string, tag: string) => new Element(tag) }; }
    replaceChildren() { this.children = []; }
    appendChild(child: Element) { this.children.push(child); }
    setAttribute(key: string, value: string) { this.attrs[key] = value; }
    querySelector(selector: string): Element | null {
      for (const child of this.children) {
        if (child.className.split(' ').includes(selector.slice(1))) return child;
        const nested = child.querySelector(selector); if (nested) return nested;
      }
      return null;
    }
  }
  const marker = new Element('div');
  marker.style.transform = 'translate(100px, 200px)';
  Object.defineProperty(marker, 'innerHTML', { set() { throw new Error('Never inject SVG markup'); } });
  updateNavigationAvatarMarker(marker as any, 'car', true, 90, 30);
  const rotor = marker.children[0];
  assert.equal(marker.style.transform, 'translate(100px, 200px)');
  assert.equal(rotor.style.transform, 'rotate(60deg)');
  assert.equal(marker.attrs['aria-label'], 'Tu ubicación · Auto');
  updateNavigationAvatarMarker(marker as any, 'car', true, 120, 30);
  assert.equal(marker.children[0], rotor, 'GPS updates reuse the SVG');
  assert.equal(rotor.style.transform, 'rotate(90deg)');
  updateNavigationAvatarMarker(marker as any, 'bicycle', true, 0, 0);
  assert.notEqual(marker.children[0], rotor);
  assert.equal(marker.dataset.navigationAvatar, 'bicycle');
  updateNavigationAvatarMarker(marker as any, 'bicycle', false);
  assert.equal(marker.dataset.navigationAvatar, 'location');
  assert.equal(marker.children[0].className, 'user-location-dot');
  assert.equal(marker.style.transform, 'translate(100px, 200px)');
});
