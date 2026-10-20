import { useSyncExternalStore } from 'react';
import { getAppActivity, subscribeAppActivity } from '../services/appLifecycle';

export function useAppActivity(): boolean {
  return useSyncExternalStore(subscribeAppActivity, getAppActivity, () => true);
}
