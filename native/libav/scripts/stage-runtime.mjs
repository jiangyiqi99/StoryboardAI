import { cpSync, existsSync, mkdirSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

export function stageRuntimeLibraries({ sidecarPath }) {
  if (!existsSync(sidecarPath)) {
    throw new Error(`Cannot stage libav runtime: sidecar not found at ${sidecarPath}`);
  }

  const runtimeDirectory = join(dirname(dirname(sidecarPath)), "runtime");
  rmSync(runtimeDirectory, { recursive: true, force: true });
  mkdirSync(runtimeDirectory, { recursive: true });

  const copied = copyDependencyClosure(sidecarPath, runtimeDirectory);
  const libraries = uniqueStagedLibraries(copied);
  if (libraries.length === 0) {
    throw new Error("Cannot stage libav runtime: no dynamic FFmpeg libraries were found.");
  }
  assertRequiredFFmpegLibraries(libraries);

  if (process.platform === "darwin") {
    rewriteMacLoadPaths(sidecarPath, copied);
  } else if (process.platform === "linux") {
    rewriteLinuxRunpaths(sidecarPath, copied);
  }

  console.log(`Staged ${libraries.length} native runtime libraries in ${runtimeDirectory}`);
}

function copyDependencyClosure(sidecarPath, runtimeDirectory) {
  const copied = new Map();
  const pending = [sidecarPath];
  const inspected = new Set();

  while (pending.length > 0) {
    const current = pending.pop();
    const currentRealPath = realpathSync(current);
    if (inspected.has(currentRealPath)) continue;
    inspected.add(currentRealPath);

    for (const dependency of dependenciesFor(currentRealPath)) {
      if (!shouldBundle(dependency)) continue;
      const realDependency = realpathSync(dependency);
      const resolvedName = basename(realDependency);
      const linkedName = basename(dependency);
      let staged = copied.get(resolvedName);
      if (!staged) {
        const destination = join(runtimeDirectory, resolvedName);
        cpSync(realDependency, destination);
        staged = { source: realDependency, destination };
        copied.set(resolvedName, staged);
        pending.push(realDependency);
      }
      if (linkedName !== resolvedName && !existsSync(join(runtimeDirectory, linkedName))) {
        symlinkSync(resolvedName, join(runtimeDirectory, linkedName));
      }
      copied.set(linkedName, staged);
    }
  }

  return copied;
}

function dependenciesFor(file) {
  if (process.platform === "darwin") return macDependencies(file);
  if (process.platform === "win32") return windowsDependencies(file);
  return linuxDependencies(file);
}

function macDependencies(file) {
  return command("otool", ["-L", file])
    .split("\n")
    .slice(1)
    .map((line) => line.trim().split(" (")[0])
    .filter((path) => path.startsWith("/"));
}

function linuxDependencies(file) {
  return command("ldd", [file])
    .split("\n")
    .map((line) => line.match(/=>\s+(\/\S+)/)?.[1] ?? line.trim().match(/^(\/\S+)/)?.[1])
    .filter(Boolean);
}

function windowsDependencies(file) {
  const msysPath = command("cygpath", ["-u", file]).trim();
  return command("ldd", [msysPath])
    .split("\n")
    .map((line) => {
      const path = line.match(/=>\s+(\S+\.dll)\b/i)?.[1]
        ?? line.trim().match(/^(\S+\.dll)\s/i)?.[1];
      return path ? windowsNativePath(path) : undefined;
    })
    .filter(Boolean);
}

function windowsNativePath(path) {
  if (/^[a-z]:[\\/]/i.test(path)) return path;
  return command("cygpath", ["-w", path]).trim();
}

function shouldBundle(dependency) {
  if (!existsSync(dependency)) return false;
  if (process.platform === "darwin") {
    return !dependency.startsWith("/System/") && !dependency.startsWith("/usr/lib/");
  }
  if (process.platform === "win32") {
    const normalized = dependency.replaceAll("/", "\\");
    return normalized.toLowerCase().endsWith(".dll")
      && !/\\windows\\system32\\/i.test(normalized);
  }

  return !/^(libc|libdl|libm|libpthread|librt|libutil|libgcc_s|libstdc\+\+|ld-linux)/.test(
    basename(dependency)
  );
}

function rewriteMacLoadPaths(sidecarPath, copied) {
  rewriteMacFile(sidecarPath, "@loader_path/../runtime", copied, false);
  for (const { destination } of uniqueStagedLibraries(copied)) {
    rewriteMacFile(destination, "@loader_path", copied, true);
  }
}

function rewriteMacFile(file, prefix, copied, setId) {
  for (const dependency of macDependencies(file)) {
    const target = copied.get(basename(dependency));
    if (target) command("install_name_tool", ["-change", dependency, `${prefix}/${basename(target.destination)}`, file]);
  }
  if (setId) command("install_name_tool", ["-id", `@loader_path/${basename(file)}`, file]);
}

function rewriteLinuxRunpaths(sidecarPath, copied) {
  command("patchelf", ["--set-rpath", "$ORIGIN/../runtime", sidecarPath]);
  for (const { destination } of uniqueStagedLibraries(copied)) {
    command("patchelf", ["--set-rpath", "$ORIGIN", destination]);
  }
}

function uniqueStagedLibraries(copied) {
  return [...new Map([...copied.values()].map((library) => [library.destination, library])).values()];
}

function assertRequiredFFmpegLibraries(libraries) {
  const names = libraries.map(({ destination }) => basename(destination).toLowerCase());
  const required = ["avformat", "avcodec", "avutil", "swscale", "swresample"];
  const missing = required.filter((name) => !names.some((library) => library.includes(name)));
  if (missing.length > 0) {
    throw new Error(
      `Cannot stage libav runtime: missing ${missing.join(", ")}. Found: ${names.join(", ")}`
    );
  }
}

function command(binary, args) {
  const result = spawnSync(binary, args, { encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${binary} ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout;
}
