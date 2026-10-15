import { upload, del } from './api';
import { AuthService } from './auth';

export interface ProfileOperation {
  signal: AbortSignal;
  isCurrent: () => boolean;
  finish: () => void;
}

/** A profile operation belongs to one mounted profile and one account generation. */
export class ProfileOperationScope {
  private active = false;
  private owner: number | undefined;
  private generation = 0;
  private requests = new Set<AbortController>();
  constructor(private currentOwner: () => number | undefined) {}

  activate(owner: number | undefined) {
    this.invalidate(); this.owner = owner; this.active = true;
  }
  invalidate() {
    this.active = false; this.generation++;
    this.requests.forEach((request) => request.abort());
    this.requests.clear();
  }
  start(): ProfileOperation {
    const generation = this.generation, owner = this.owner;
    const controller = new AbortController();
    if (!this.active || owner === undefined || this.currentOwner() !== owner) controller.abort();
    if (!controller.signal.aborted) this.requests.add(controller);
    return {
      signal: controller.signal,
      isCurrent: () => this.active && !controller.signal.aborted && owner === this.owner && generation === this.generation && this.currentOwner() === owner,
      finish: () => { this.requests.delete(controller); },
    };
  }
}

interface RecoveryInput { telefonoNuevo: string; motivo: string; adjuntoId?: string; }
interface RecoveryPorts {
  upload: typeof upload;
  recover: (data: RecoveryInput, signal: AbortSignal) => Promise<unknown>;
  remove: (id: string, signal: AbortSignal) => Promise<unknown>;
}

const recoveryPorts: RecoveryPorts = {
  upload,
  recover: (data, signal) => AuthService.requestPhoneRecovery(data, signal),
  remove: (id, signal) => del(`/uploads/${encodeURIComponent(id)}`, { signal }),
};

export async function submitProfileRecovery(
  operation: ProfileOperation,
  input: RecoveryInput,
  file: File | null,
  ports: RecoveryPorts = recoveryPorts
): Promise<boolean> {
  if (!operation.isCurrent()) return false;
  let attachmentId: string | undefined;
  try {
    if (file) {
      const attachment = await ports.upload(file, true, 'IDENTIDAD', { signal: operation.signal });
      if (!operation.isCurrent()) return false;
      attachmentId = attachment.id;
    }
    // Check again immediately before the second authenticated request.
    if (!operation.isCurrent()) return false;
    await ports.recover({ ...input, adjuntoId: attachmentId }, operation.signal);
    return operation.isCurrent();
  } catch (error) {
    // DELETE is allowed only while the same mounted account still owns this operation.
    if (attachmentId && operation.isCurrent()) {
      try { await ports.remove(attachmentId, operation.signal); } catch { /* Server owns orphan cleanup if this attempt fails. */ }
    }
    throw error;
  }
}
