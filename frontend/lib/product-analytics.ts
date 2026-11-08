import type { PostHog } from 'posthog-js';
import { PRODUCT_EVENTS, sanitizeAnalyticsProperties } from './analytics-policy';

let client: Promise<PostHog | null> | null = null;
export function productAnalyticsAllowed(): boolean {
  if (typeof window === 'undefined' || !process.env.NEXT_PUBLIC_POSTHOG_KEY?.trim()) return false;
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
  if (nav.doNotTrack === '1' || nav.globalPrivacyControl) return false;
  try { return localStorage.getItem('civigo.analytics.optout') !== 'true'; } catch { return false; }
}
function getClient(): Promise<PostHog | null> {
  if (!productAnalyticsAllowed()) return Promise.resolve(null);
  if (client) return client;
  client = import('posthog-js').then(({ default: posthog }) => {
    if (!productAnalyticsAllowed()) return null;
    const host = process.env.NEXT_PUBLIC_POSTHOG_HOST === 'https://eu.i.posthog.com' ? 'https://eu.i.posthog.com' : 'https://us.i.posthog.com';
    posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY!.trim(), {
      api_host: host,
      persistence: 'memory', disable_persistence: true,
      person_profiles: 'never', autocapture: false, capture_pageview: false, capture_pageleave: false,
      capture_exceptions: false, capture_performance: false, capture_dead_clicks: false,
      disable_session_recording: true, disable_surveys: true,
      disable_external_dependency_loading: true, advanced_disable_flags: true,
      ip: false, respect_dnt: true,
      before_send: event => {
        if (!event || !productAnalyticsAllowed() || !PRODUCT_EVENTS.has(event.event)) return null;
        event.properties = sanitizeAnalyticsProperties(event.properties);
        return event;
      },
    });
    return posthog;
  }).catch(() => { client = null; return null; });
  return client;
}

export function captureProductEvent(event: string, properties: Record<string, unknown> = {}): void {
  if (!PRODUCT_EVENTS.has(event) || !productAnalyticsAllowed()) return;
  void getClient().then(posthog => {
    if (productAnalyticsAllowed()) posthog?.capture(event, sanitizeAnalyticsProperties(properties));
  }).catch(() => { /* Optional analytics must never interrupt navigation. */ });
}
