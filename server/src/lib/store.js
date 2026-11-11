/**
 * Persistence layer.
 *
 * Reads are served from memory (the working set of a single merchant is small),
 * writes go through to MongoDB when MONGODB_URI is set, or to a JSON snapshot on
 * disk otherwise. Uploaded evidence files are stored as binary in MongoDB or as
 * files under DATA_DIR/uploads.
 */
import fs from 'node:fs'
import path from 'node:path'
import { config } from '../config.js'

const COLLECTIONS = ['orders', 'disputes', 'activity', 'sessions', 'checkouts', 'meta']
const ACTIVITY_LIMIT = 300

class Store {
  constructor() {
    this.maps = Object.fromEntries(COLLECTIONS.map((name) => [name, new Map()]))
    this.db = null
    this.snapshotFile = path.join(config.dataDir, 'store.json')
    this.uploadDir = path.join(config.dataDir, 'uploads')
    this.flushTimer = null
    this.backend = 'file'
  }

  async init() {
    if (config.mongoUri) {
      const { MongoClient } = await import('mongodb')
      const client = new MongoClient(config.mongoUri, { serverSelectionTimeoutMS: 8000 })
      await client.connect()
      this.db = client.db()
      this.backend = 'mongodb'
      for (const name of COLLECTIONS) {
        const docs = await this.db.collection(name).find({}).toArray()
        for (const { _id, ...doc } of docs) this.maps[name].set(doc.id ?? _id, doc)
      }
    } else {
      fs.mkdirSync(this.uploadDir, { recursive: true })
      if (fs.existsSync(this.snapshotFile)) {
        try {
          const snapshot = JSON.parse(fs.readFileSync(this.snapshotFile, 'utf8'))
          for (const name of COLLECTIONS) {
            for (const doc of snapshot[name] || []) this.maps[name].set(doc.id, doc)
          }
        } catch (error) {
          console.warn('[store] Snapshot unreadable, starting empty:', error.message)
        }
      }
    }
    console.log(`[store] ${this.backend} backend · ${this.maps.orders.size} orders · ${this.maps.disputes.size} disputes`)
  }

  all(name) {
    return [...this.maps[name].values()]
  }

  get(name, id) {
    return this.maps[name].get(id) ?? null
  }

  async put(name, doc) {
    if (!doc?.id) throw new Error(`store.put(${name}) requires an id`)
    this.maps[name].set(doc.id, doc)
    if (name === 'activity') this.#trimActivity()
    if (this.db) {
      await this.db.collection(name).replaceOne({ _id: doc.id }, { ...doc, _id: doc.id }, { upsert: true })
    } else {
      this.#scheduleFlush()
    }
    return doc
  }

  async remove(name, id) {
    this.maps[name].delete(id)
    if (this.db) await this.db.collection(name).deleteOne({ _id: id })
    else this.#scheduleFlush()
  }

  async clear(name) {
    this.maps[name].clear()
    if (this.db) await this.db.collection(name).deleteMany({})
    else this.#scheduleFlush()
  }

  /** Monotonic counter, e.g. for human-readable order numbers. */
  async next(counter, start) {
    const doc = this.get('meta', `counter:${counter}`) || { id: `counter:${counter}`, value: start - 1 }
    doc.value += 1
    await this.put('meta', doc)
    return doc.value
  }

  async saveFile(id, buffer) {
    if (this.db) {
      await this.db.collection('files').replaceOne({ _id: id }, { _id: id, data: buffer }, { upsert: true })
    } else {
      await fs.promises.writeFile(path.join(this.uploadDir, id), buffer)
    }
  }

  async readFile(id) {
    if (this.db) {
      const doc = await this.db.collection('files').findOne({ _id: id })
      return doc ? Buffer.from(doc.data.buffer ?? doc.data) : null
    }
    const file = path.join(this.uploadDir, path.basename(id))
    return fs.existsSync(file) ? fs.promises.readFile(file) : null
  }

  async clearFiles() {
    if (this.db) {
      await this.db.collection('files').deleteMany({})
    } else if (fs.existsSync(this.uploadDir)) {
      for (const entry of fs.readdirSync(this.uploadDir)) fs.rmSync(path.join(this.uploadDir, entry), { force: true })
    }
  }

  #trimActivity() {
    const map = this.maps.activity
    if (map.size <= ACTIVITY_LIMIT) return
    const oldest = [...map.values()].sort((a, b) => a.at.localeCompare(b.at)).slice(0, map.size - ACTIVITY_LIMIT)
    for (const doc of oldest) {
      map.delete(doc.id)
      if (this.db) this.db.collection('activity').deleteOne({ _id: doc.id }).catch(() => {})
    }
  }

  #scheduleFlush() {
    if (this.flushTimer) return
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null
      this.flushNow()
    }, 150)
  }

  flushNow() {
    if (this.db) return
    try {
      fs.mkdirSync(config.dataDir, { recursive: true })
      const snapshot = Object.fromEntries(COLLECTIONS.map((name) => [name, this.all(name)]))
      const tmp = `${this.snapshotFile}.tmp`
      fs.writeFileSync(tmp, JSON.stringify(snapshot))
      fs.renameSync(tmp, this.snapshotFile)
    } catch (error) {
      console.error('[store] Failed to write snapshot:', error.message)
    }
  }
}

export const store = new Store()

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    store.flushNow()
    process.exit(0)
  })
}
