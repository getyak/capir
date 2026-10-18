// Builder-only verification of pnpm 11.18 v11 CAFS bytes. No index is read or
// written; this closes pnpm's mtime fast path for imported cache content.
const { constants } = require("node:fs");
const fs = require("node:fs/promises");
const { createHash } = require("node:crypto");

const directoryFlags = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;
const fileFlags = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;
const descriptorPath = (handle) => `/proc/self/fd/${handle.fd}`;

async function verifyDependencyCache(storeRoot = "/root/.local/share/pnpm/store") {
  if (process.platform !== "linux") {
    throw new Error("Dependency cache verification requires the Linux builder.");
  }
  const handles = [];
  const result = { files: 0, bytes: 0 };
  try {
    let location = storeRoot;
    for (const next of ["v11", "files", null]) {
      let handle;
      try {
        handle = await fs.open(location, directoryFlags);
      } catch (error) {
        if (error.code === "ENOENT") return result;
        throw error;
      }
      handles.push(handle);
      location = next === null ? descriptorPath(handle) : `${descriptorPath(handle)}/${next}`;
    }
    for await (const bucket of await fs.opendir(location)) {
      if (!bucket.isDirectory() || !/^[a-f0-9]{2}$/.test(bucket.name)) {
        throw new Error("Invalid CAFS bucket schema or symbolic link.");
      }
      const directory = await fs.open(`${location}/${bucket.name}`, directoryFlags);
      try {
        for await (const entry of await fs.opendir(descriptorPath(directory))) {
          const encoded = /^([a-f0-9]{126})(?:-exec)?$/.exec(entry.name);
          if (!entry.isFile() || !encoded) {
            throw new Error("Invalid CAFS content schema or symbolic link.");
          }
          const file = await fs.open(`${descriptorPath(directory)}/${entry.name}`, fileFlags);
          try {
            if (!(await file.stat()).isFile()) throw new Error("CAFS content must be a regular file.");
            const hash = createHash("sha512");
            let bytes = 0;
            for await (const chunk of file.createReadStream({ autoClose: false, highWaterMark: 64 * 1024 })) {
              hash.update(chunk);
              bytes += chunk.length;
            }
            if (hash.digest("hex") !== bucket.name + encoded[1]) {
              throw new Error("CAFS content digest mismatch.");
            }
            result.files += 1;
            result.bytes += bytes;
          } finally {
            await file.close();
          }
        }
      } finally {
        await directory.close();
      }
    }
    return result;
  } finally {
    for (const handle of handles.reverse()) await handle.close();
  }
}

module.exports = { verifyDependencyCache };

if (require.main === module) {
  verifyDependencyCache().then(
    (result) => console.log(JSON.stringify({ verifiedDependencyCache: result })),
    (error) => {
      console.error(`Dependency cache verification failed: ${error.code ?? error.message}`);
      process.exitCode = 1;
    },
  );
}
