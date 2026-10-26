const revisions = new Map<string, number>()

export function invalidateReadTables(...tableIds: string[]) {
  for (const tableId of tableIds) revisions.set(tableId, (revisions.get(tableId) || 0) + 1)
}

const revisionFor = (tables: string[]) => tables.map(table => `${table}:${revisions.get(table) || 0}`).join('|')

export class ReadCache {
  private entries = new Map<string, { revision: string; expiresAt: number; promise: Promise<unknown> }>()

  constructor(private readonly maxEntries = 40, private readonly clock = Date.now) {}

  get<T>(key: string, ttlMs: number, tables: string[], loader: () => Promise<T>): Promise<T> {
    const revision = revisionFor(tables)
    const cached = this.entries.get(key)
    if (cached && cached.revision === revision && cached.expiresAt > this.clock()) {
      this.entries.delete(key)
      this.entries.set(key, cached)
      return cached.promise.then(value => structuredClone(value) as T)
    }
    const entry = { revision, expiresAt: Infinity, promise: Promise.resolve() as Promise<unknown> }
    entry.promise = Promise.resolve().then(loader).then(value => {
      if (revisionFor(tables) !== revision) {
        if (this.entries.get(key) === entry) this.entries.delete(key)
      } else entry.expiresAt = this.clock() + ttlMs
      return value
    }).catch(error => {
      if (this.entries.get(key) === entry) this.entries.delete(key)
      throw error
    })
    this.entries.set(key, entry)
    while (this.entries.size > this.maxEntries) this.entries.delete(this.entries.keys().next().value!)
    return entry.promise.then(value => structuredClone(value) as T)
  }

  clear() { this.entries.clear() }
  delete(key: string) { this.entries.delete(key) }
}
