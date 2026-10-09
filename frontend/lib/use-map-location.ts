'use client';
import { useCallback, useEffect, useState } from 'react';
import { watchMapPosition, type MapLocationStatus } from './map-location';
import { isPosition } from './route-cache';
import type { LocationFix } from './types';

type LocationState = {position: LocationFix | null; status: MapLocationStatus; error: string};

export function useMapLocation(navigationPosition: LocationFix | null, following: boolean) {
    const [requested, setRequested] = useState(false);
    const [revision, setRevision] = useState(0);
    const [location, setLocation] = useState<LocationState>({position: null, status: 'idle', error: ''});

    useEffect(() => {
        let active = true;
        let permission: PermissionStatus | undefined;
        const permissionChanged = () => {
            if (!active || !permission) return;
            if (permission.state === 'granted') setRequested(true);
            if (permission.state === 'denied') {
                setRequested(false);
                setLocation({position: null, status: 'denied', error: 'Permite el acceso a tu ubicación en el navegador para ver reportes a menos de 1 km.'});
            }
        };
        // Checking an existing permission does not open a prompt. A first request
        // is left to the "Usar mi ubicación" action.
        if (navigator.permissions) {
            void navigator.permissions.query({name: 'geolocation'}).then(result => {
                if (!active) return;
                permission = result;
                permission.addEventListener('change', permissionChanged);
                permissionChanged();
            }).catch(() => { /* Browsers without Permissions API use the explicit action. */ });
        }
        return () => {
            active = false;
            permission?.removeEventListener('change', permissionChanged);
        };
    }, []);

    useEffect(() => {
        if (!requested || following) return;
        let active = true;
        void Promise.resolve().then(() => {
            if (active) setLocation(current => current.position ? current : {...current, status: 'locating', error: ''});
        });
        const stop = watchMapPosition(navigator.geolocation,
            point => { if (active) setLocation({position: point, status: 'ready', error: ''}); },
            failure => { if (active) setLocation({position: null, status: failure.status, error: failure.message}); },
        );
        return () => { active = false; stop(); };
    }, [requested, revision, following]);

    useEffect(() => {
        if (!following || !isPosition(navigationPosition)) return;
        let active = true;
        void Promise.resolve().then(() => {
            if (!active) return;
            // A fix acquired while navigating is also real GPS. Preserve it
            // when the trip ends and resume the browsing watch afterward.
            setLocation({position: navigationPosition, status: 'ready', error: ''});
            setRequested(true);
        });
        return () => { active = false; };
    }, [following, navigationPosition]);

    const requestLocation = useCallback(() => {
        setLocation({position: null, status: 'locating', error: ''});
        setRequested(true);
        setRevision(value => value + 1);
    }, []);

    // Only GPS callbacks should call this. Route origins and map centers may be
    // arbitrary addresses and must never stand in for the user's location.
    const acceptPosition = useCallback((position: LocationFix) => {
        if (!isPosition(position)) return;
        setLocation({position, status: 'ready', error: ''});
        setRequested(true);
        setRevision(value => value + 1);
    }, []);

    const position = following ? navigationPosition : location.position;
    return {
        position,
        status: following ? (position ? 'ready' : 'locating') as MapLocationStatus : location.status,
        error: following ? '' : location.error,
        requestLocation,
        acceptPosition,
    };
}
