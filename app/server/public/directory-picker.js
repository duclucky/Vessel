export function supportsDirectoryPicker(scope = globalThis) {
  return typeof scope?.showDirectoryPicker === 'function';
}

function attachRelativePath(file, relativePath) {
  Object.defineProperty(file, 'vesselRelativePath', {
    configurable: true,
    value: relativePath,
  });
  return file;
}

export async function collectDirectoryFiles(directory) {
  if (!directory || directory.kind !== 'directory' || typeof directory.values !== 'function') {
    throw new TypeError('A readable directory handle is required');
  }

  const files = [];
  const rootName = String(directory.name || 'collection');

  async function walk(handle, parentPath) {
    for await (const entry of handle.values()) {
      const relativePath = `${parentPath}/${entry.name}`;
      if (entry.kind === 'directory') {
        await walk(entry, relativePath);
      } else if (entry.kind === 'file') {
        const file = await entry.getFile();
        files.push(attachRelativePath(file, relativePath));
      }
    }
  }

  await walk(directory, rootName);
  return files;
}
