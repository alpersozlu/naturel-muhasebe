// "next/headers" stub for one-off local scripts (no request scope outside Next).
const empty = () => ({ get: () => undefined, getAll: () => [], has: () => false, entries: () => [][Symbol.iterator]() });
module.exports = { cookies: async () => empty(), headers: async () => empty(), draftMode: async () => ({ isEnabled: false }) };
