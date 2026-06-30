import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const temporary = mkdtempSync(join(tmpdir(), "multisession-package-smoke-"));
const consumer = join(temporary, "consumer");

try {
  execFileSync("pnpm", ["pack", "--pack-destination", temporary], {
    cwd: root,
    stdio: "inherit",
  });
  const tarballName = readdirSync(temporary).find((name) => name.endsWith(".tgz"));
  if (!tarballName) throw new Error("pnpm pack did not produce a tarball");
  const tarball = join(temporary, tarballName);
  const listing = execFileSync("tar", ["-tzf", tarball], { encoding: "utf8" });
  for (const required of [
    "package/package.json",
    "package/README.md",
    "package/LICENSE",
    "package/dist/index.js",
    "package/dist/index.d.ts",
  ]) {
    if (!listing.split("\n").includes(required)) {
      throw new Error(`packed tarball is missing ${required}`);
    }
  }

  mkdirSync(consumer);
  writeFileSync(
    join(consumer, "package.json"),
    JSON.stringify(
      {
        name: "multisession-package-consumer-smoke",
        private: true,
        type: "module",
        dependencies: {
          "p2p-lockstep-kit-multisession": `file:${tarball}`,
        },
      },
      null,
      2,
    ),
  );
  writeFileSync(
    join(consumer, "runtime.mjs"),
    `import { participantId } from "p2p-lockstep-kit-multisession";\n` +
      `if (participantId("consumer-1") !== "consumer-1") throw new Error("runtime import failed");\n`,
  );
  writeFileSync(
    join(consumer, "types.ts"),
    `import { participantId, type ParticipantId } from "p2p-lockstep-kit-multisession";\n` +
      `const id: ParticipantId = participantId("consumer-1");\n` +
      `void id;\n`,
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
  execFileSync(join(root, "node_modules", ".bin", "tsc"), ["-p", "tsconfig.json"], {
    cwd: consumer,
    stdio: "inherit",
  });
  execFileSync(process.execPath, ["runtime.mjs"], {
    cwd: consumer,
    stdio: "inherit",
  });

  const packedPackage = JSON.parse(
    readFileSync(join(consumer, "node_modules", "p2p-lockstep-kit-multisession", "package.json"), "utf8"),
  );
  if (packedPackage.main !== "./dist/index.js" || packedPackage.types !== "./dist/index.d.ts") {
    throw new Error("packed package entry points are incorrect");
  }
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
