class SimpleCache {
  constructor() { this.store = new Map(); }
  get(key) {
    const item = this.store.get(key);
    if (!item) return null;
    if (Date.now() > item.expires) { this.store.delete(key); return null; }
    return item.value;
  }
  set(key, value, ttlSeconds = 60) {
    this.store.set(key, { value, expires: Date.now() + ttlSeconds * 1000 });
  }
  del(key) { this.store.delete(key); }
  flush() { this.store.clear(); }
}
const cache = new SimpleCache();
module.exports = { cache };
