import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const multisessionRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const temporary = mkdtempSync(join(tmpdir(), "multisession-network-smoke-"));
const consumer = join(temporary, "consumer");

const pack = (command, root, namePrefix) => {
  execFileSync(command, ["pack", "--pack-destination", temporary], {
    cwd: root,
    stdio: "inherit",
  });
  const name = readdirSync(temporary).find(
    (entry) => entry.startsWith(namePrefix) && entry.endsWith(".tgz"),
  );
  if (!name) throw new Error(`package tarball not found: ${namePrefix}`);
  return join(temporary, name);
};

try {
  const multisessionTarball = pack(
    "pnpm",
    multisessionRoot,
    "p2p-lockstep-kit-multisession-",
  );

  mkdirSync(consumer);
  writeFileSync(
    join(consumer, "package.json"),
    JSON.stringify(
      {
        name: "multisession-network-consumer-smoke",
        private: true,
        type: "module",
        dependencies: {
          "p2p-lockstep-kit-multisession": `file:${multisessionTarball}`,
        },
      },
      null,
      2,
    ),
  );
  writeFileSync(
    join(consumer, "types.ts"),
    `import { EndpointMeshTransport, NetworkEndpoint, type MultiPeerTransport, type PeerId, type SharedPeerEndpoint } from "p2p-lockstep-kit-multisession";\n` +
      `const endpoint = new NetworkEndpoint<PeerId>();\n` +
      `const compatible: SharedPeerEndpoint = endpoint;\n` +
      `const createTransport = async (): Promise<MultiPeerTransport> => {\n` +
      `  await endpoint.register("wss://signal.test");\n` +
      `  return new EndpointMeshTransport(endpoint);\n` +
      `};\n` +
      `void compatible;\n` +
      `void createTransport;\n` +
      `endpoint.dispose();\n`,
  );
  writeFileSync(
    join(consumer, "runtime.mjs"),
    `import { NetworkEndpoint, participantId } from "p2p-lockstep-kit-multisession";\n` +
      `const endpoint = new NetworkEndpoint();\n` +
      `if (participantId("consumer-1") !== "consumer-1") throw new Error("runtime import failed");\n` +
      `endpoint.dispose();\n`,
  );
  writeFileSync(
    join(consumer, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: {
          target: "ES2022",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          strict: true,
          noEmit: true,
          skipLibCheck: false,
        },
        include: ["types.ts"],
      },
      null,
      2,
    ),
  );

  execFileSync("pnpm", ["install", "--ignore-scripts"], {
    cwd: consumer,
    stdio: "inherit",
  });
  execFileSync(
    join(multisessionRoot, "node_modules", ".bin", "tsc"),
    ["-p", "tsconfig.json"],
    { cwd: consumer, stdio: "inherit" },
  );
  execFileSync(process.execPath, ["runtime.mjs"], {
    cwd: consumer,
    stdio: "inherit",
  });
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
