// Test double for libWrapper's documented MIXED chain contract.  Live Foundry
// and the real libWrapper remain a separate integration check.
const registered = new Map();
globalThis.libWrapper = {
  register(id, path, wrapper) {
    if (registered.has(path)) throw new Error(`Duplicate wrapper: ${path}`);
    const parts = path.split('.'),
      key = parts.pop();
    const object = parts.reduce((value, part) => value[part], globalThis),
      original = object[key];
    object[key] = function (...args) {
      return wrapper.call(this, original.bind(this), ...args);
    };
    registered.set(path, { object, key, original });
  },
  unregister(id, path) {
    const r = registered.get(path);
    if (r) {
      r.object[r.key] = r.original;
      registered.delete(path);
    }
  },
};
