"use client";
import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { captureProductEvent, productAnalyticsAllowed } from '@/lib/product-analytics';
import { analyticsPage } from '@/lib/analytics-policy';

export default function ProductAnalytics() {
  const path = usePathname();
  const last = useRef('');
  useEffect(() => {
    if (!productAnalyticsAllowed()) return;
    if (path !== last.current) {
      last.current = path;
      captureProductEvent('$pageview', { page: analyticsPage(path) });
    }
    const click = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target.closest('[data-home-action]') : null;
      if (target) captureProductEvent('civigo_home_action', { page: '/', action: target.getAttribute('data-home-action') });
    };
    document.addEventListener('click', click);
    return () => document.removeEventListener('click', click);
  }, [path]);
  return null;
}
