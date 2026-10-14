type OrientationCamera = { easeTo: (options: { bearing: number; pitch: number; duration: number }) => unknown };

export function resetMapOrientation(camera: OrientationCamera | null, stopFollowing: () => void): boolean {
    if (!camera) return false;
    stopFollowing();
    // Keeping center and zoom out of this operation preserves the view chosen
    // by the user. GPS recentering remains a separate action.
    camera.easeTo({ bearing: 0, pitch: 0, duration: 450 });
    return true;
}
