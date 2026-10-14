"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const reset = require("../src/lib/explicit-data-reset");

function parseArguments(args) {
  const values = { apply: false };
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (flag === "--apply") {
      values.apply = true;
      continue;
    }
    const names = {
      "--input": "input",
      "--snapshot": "snapshot",
      "--confirm-target": "confirmTarget",
      "--output": "output",
    };
    const key = names[flag];
    if (
      !key ||
      values[key] !== undefined ||
      !args[index + 1] ||
      args[index + 1].startsWith("--")
    )
      throw Object.assign(new Error("Argumentos inválidos."), {
        code: "RESET_INPUT",
      });
    values[key] = args[++index];
  }
  if (
    !values.input ||
    (values.apply &&
      (!values.snapshot || !values.confirmTarget || !values.output)) ||
    (!values.apply && values.confirmTarget)
  )
    throw Object.assign(
      new Error(
        "Indica el archivo privado; aplicar exige respaldo, huella y salida privada.",
      ),
      { code: "RESET_INPUT" },
    );
  return values;
}

function privatePath(value) {
  const resolved = path.resolve(value);
  const roots = [
    path.resolve(__dirname, "../.local"),
    path.resolve(__dirname, "../../.local"),
  ];
  if (
    !roots.some((root) => {
      const relative = path.relative(root, resolved);
      return (
        relative &&
        relative !== ".." &&
        !relative.startsWith(".." + path.sep) &&
        !path.isAbsolute(relative)
      );
    })
  )
    throw Object.assign(
      new Error(
        "Los archivos del reinicio deben estar dentro de .local y fuera de Git.",
      ),
      { code: "RESET_PRIVATE_FILE" },
    );
  return resolved;
}

async function readPrivateJSON(value) {
  const file = privatePath(value);
  const info = await fs.lstat(file);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 512 * 1024 * 1024)
    throw Object.assign(new Error("Archivo privado inválido."), {
      code: "RESET_PRIVATE_FILE",
    });
  return JSON.parse(await fs.readFile(file, "utf8"));
}

async function main(args = process.argv.slice(2)) {
  const options = parseArguments(args);
  const input = await readPrivateJSON(options.input);
  reset.validateInput(input);
  const snapshot = options.snapshot
    ? await readPrivateJSON(options.snapshot)
    : undefined;
  require("dotenv").config({ quiet: true });
  const connection = process.env.DATABASE_URL;
  const database = require("../src/lib/db");
  let output;
  try {
    if (options.output) {
      const destination = privatePath(options.output);
      await fs.mkdir(path.dirname(destination), { recursive: true });
      // Reserve the result before touching the database, never overwrite a backup.
      output = await fs.open(destination, "wx", 0o600);
    }
    const plan = await reset.planExplicitReset({
      database,
      connection,
      input,
      snapshot,
    });
    if (!options.apply) {
      if (output) await output.writeFile(JSON.stringify(plan, null, 2));
      console.log(JSON.stringify(plan, null, 2));
      return plan;
    }
    const {
      buildInitialIncidentDataset,
    } = require("../src/lib/initial-incident-dataset");
    const { getRoads } = require("../src/lib/roads");
    const result = await reset.applyExplicitReset({
      database,
      connection,
      input,
      snapshot,
      confirmTarget: options.confirmTarget,
      buildDataset: buildInitialIncidentDataset,
      roads: getRoads(),
    });
    await output.writeFile(JSON.stringify(result, null, 2));
    console.log(
      JSON.stringify(
        {
          mode: result.mode,
          counts: result.counts,
          targetFingerprint: result.targetFingerprint,
          accounts: result.accounts,
          preservedAdvertisingFiles: result.preservedAdvertisingFileIds.length,
          storageObjectsPendingRemoval:
            result.storageObjectsToRemoveAfterCommit.length,
        },
        null,
        2,
      ),
    );
    return result;
  } finally {
    await output?.close();
    await database.$disconnect();
  }
}

if (require.main === module)
  main().catch((error) => {
    // Provider and filesystem errors may contain credentials or private filenames.
    const known =
      typeof error.code === "string" && error.code.startsWith("RESET_");
    console.error(
      known
        ? `${error.code}: ${error.message}`
        : "No se pudo completar el reinicio explícito. Revisa la conexión o el archivo privado; no se muestran secretos.",
    );
    process.exitCode = 1;
  });

module.exports = { parseArguments, privatePath, readPrivateJSON, main };
