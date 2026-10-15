import { useEffect, useRef } from 'react';
import { OperationScope } from '../services/operationScope';

export function useOperationScope(identity: string): OperationScope {
  const current = useRef(identity);
  const mounted = useRef(true);
  const scope = useRef<OperationScope | null>(null);
  current.current = identity;
  if (!scope.current) scope.current = new OperationScope(() => current.current, () => mounted.current);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; scope.current?.cancel(); };
  }, [identity]);
  return scope.current;
}
