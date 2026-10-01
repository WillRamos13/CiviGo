"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { PGLiteSocketServer } = require("@electric-sql/pglite-socket");

// Temporary compatibility adapter for the optional, single-client local server.
// Upstream 0.2.11 leaves processing=true after a protocol throw and retains a
// detached handler after its error event. The fixes use its verified runtime
// layout; fail clearly after an upgrade instead of patching an unknown version.
// https://github.com/electric-sql/pglite/issues/1046
function guardRuntime(server) {
  const filename = path.join(
    path.dirname(require.resolve("@electric-sql/pglite-socket")),
    "../package.json",
  );
  const version = JSON.parse(fs.readFileSync(filename, "utf8")).version;
  if (
    version !== "0.2.11" ||
    !(server.handlers instanceof Set) ||
    !Array.isArray(server.queryQueue?.queue) ||
    typeof server.queryQueue.processQueue !== "function" ||
    typeof PGLiteSocketServer.prototype.handleConnection !== "function"
  ) {
    throw new Error(
      "El adaptador local requiere pglite-socket 0.2.11; revisa su compatibilidad antes de actualizarlo.",
    );
  }
}

class LocalSocketServer extends PGLiteSocketServer {
  constructor(options) {
    super({
      ...options,
      maxConnections: 1,
      idleTimeout: options.idleTimeout ?? 0,
    });
    guardRuntime(this);
    const queue = this.queryQueue;
    const enqueue = queue.enqueue.bind(queue);
    queue.enqueue = (handlerId, message, onData) => {
      // PGlite sends ReadyForQuery immediately after extended-protocol errors.
      // PostgreSQL sends it only after Sync; Prisma otherwise loses its pipeline.
      // https://github.com/electric-sql/pglite/issues/958
      const extended = ![0, 81, 83, 88].includes(message[0]);
      if (!extended) return enqueue(handlerId, message, onData);
      let buffered = Buffer.alloc(0);
      return enqueue(handlerId, message, (bytes) => {
        buffered = Buffer.concat([buffered, bytes]);
        while (buffered.length >= 5) {
          const size = buffered.readInt32BE(1) + 1;
          if (size < 5)
            throw new Error("Respuesta inválida del protocolo local.");
          if (buffered.length < size) break;
          const frame = buffered.subarray(0, size);
          buffered = buffered.subarray(size);
          if (frame[0] !== 90) onData(frame);
        }
      }).then((size) => {
        if (buffered.length)
          throw new Error("Respuesta incompleta del protocolo local.");
        return size;
      });
    };
    const process = queue.processQueue.bind(queue);
    let running = null;
    queue.processQueue = () => {
      if (queue.processing || !queue.queue.length) return Promise.resolve();
      const operation = process();
      const completed = operation
        .catch((error) => {
          for (const waiting of queue.queue.splice(0)) waiting.reject(error);
        })
        .finally(() => {
          queue.processing = false;
          if (running === completed) running = null;
          if (queue.queue.length && !this.db.isInTransaction())
            setImmediate(() => queue.processQueue());
        });
      running = completed;
      return completed;
    };
    queue.clearTransactionIfNeeded = async (handlerId) => {
      // A disconnect can arrive while BEGIN is still executing. Drain the active
      // protocol operation before checking its final transaction state.
      while (running) await running;
      if (this.db.isInTransaction() && queue.lastHandlerId === handlerId) {
        await this.db.exec("ROLLBACK");
        queue.lastHandlerId = null;
      }
      await queue.processQueue();
    };
  }

  async handleConnection(socket) {
    const existing = new Set(this.handlers);
    await PGLiteSocketServer.prototype.handleConnection.call(this, socket);
    for (const handler of this.handlers) {
      if (existing.has(handler)) continue;
      const detach = handler.detach.bind(handler);
      let cleanup = null;
      handler.detach = (close) => {
        if (cleanup) return cleanup;
        cleanup = detach(close)
          .catch(() => {
            this.dispatchEvent(
              new CustomEvent("error", {
                detail: new Error(
                  "No se pudo limpiar la sesión de la base local. Reinicia el ayudante si no se recupera.",
                ),
              }),
            );
            return handler;
          })
          .finally(() => {
            // Native close listeners may have been removed by upstream detach.
            // Always release the logical slot after rollback/cleanup completes.
            this.handlers.delete(handler);
            if ((close ?? true) && !socket.destroyed) socket.destroy();
          });
        return cleanup;
      };
    }
  }

  async stop() {
    this.active = false;
    await Promise.all(
      [...this.handlers].map((handler) => handler.detach(true)),
    );
    await super.stop();
  }
}

module.exports = { LocalSocketServer };
