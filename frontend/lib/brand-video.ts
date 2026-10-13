// The approved MP4 is composited on a charcoal background. Key its decoded
// frames at display resolution so the same animation can sit on either theme.
export function transparentBrandPixels(pixels: Uint8ClampedArray, dark: boolean) {
    for (let index = 0; index < pixels.length; index += 4) {
        const maximum = Math.max(pixels[index], pixels[index + 1], pixels[index + 2]);
        const minimum = Math.min(pixels[index], pixels[index + 1], pixels[index + 2]);
        if (maximum <= 40) { pixels[index + 3] = 0; continue; }
        if (maximum < 75) pixels[index + 3] = Math.round(pixels[index + 3] * (maximum - 40) / 35);
        // Only neutral lettering changes: keep the blue/cyan pin and Go intact.
        if (!dark && maximum - minimum < 28 && maximum > 75) {
            pixels[index] = 7; pixels[index + 1] = 30; pixels[index + 2] = 50;
            pixels[index + 3] = Math.round(pixels[index + 3] * (maximum - 20) / 235);
        }
    }
}

export function paintTransparentBrand(canvas: HTMLCanvasElement, source: CanvasImageSource, dark: boolean) {
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return false;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(source, 330, 216, 620, 268, 0, 0, canvas.width, canvas.height);
    const frame = context.getImageData(0, 0, canvas.width, canvas.height);
    transparentBrandPixels(frame.data, dark);
    context.putImageData(frame, 0, 0);
    return true;
}
