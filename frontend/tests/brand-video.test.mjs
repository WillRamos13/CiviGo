import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTs } from './helpers/ts-module.mjs';
const { transparentBrandPixels } = loadTs('lib/brand-video.ts');
test('logo preserves blue branding and removes charcoal pixels in both themes', () => {
    for (const dark of [false, true]) {
        const pixels = new Uint8ClampedArray([20,20,20,255, 15,108,225,255, 12,65,160,255]);
        transparentBrandPixels(pixels, dark);
        assert.equal(pixels[3],0);
        assert.deepEqual([...pixels.slice(4)], [15,108,225,255,12,65,160,255]);
    }
});
test('neutral lettering contrasts with the light theme while the dark theme stays white', () => {
    const light = new Uint8ClampedArray([255,255,255,255]), dark = new Uint8ClampedArray(light);
    transparentBrandPixels(light,false); transparentBrandPixels(dark,true);
    assert.deepEqual([...light],[7,30,50,255]); assert.deepEqual([...dark],[255,255,255,255]);
});
