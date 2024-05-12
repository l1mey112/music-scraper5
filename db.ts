import { drizzle } from 'drizzle-orm/bun-sqlite'
import { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite'
import { Database } from 'bun:sqlite'
import * as schema from './schema'
import { fs_sqlite } from './fs'
import { atexit_last } from './atexit'

export const sqlite: Database = new Database(fs_sqlite, { create: false, readwrite: true })

//sqlite.exec("pragma locking_mode = EXCLUSIVE;") // exclusive locking
sqlite.exec("pragma journal_mode = WAL;")
sqlite.exec("pragma synchronous = normal;") // safe with WAL
sqlite.exec("pragma temp_store = memory;")
sqlite.exec("pragma mmap_size = 30000000000;")
//sqlite.exec("pragma auto_vacuum = incremental;") // TODO: needs to be set at db creation before tables, so why call it here?
sqlite.loadExtension("./chromaprint") // chromaprint.c

export const db: BunSQLiteDatabase<typeof schema> = drizzle(sqlite, { schema, logger: false })

function db_close() {
	sqlite.exec("pragma wal_checkpoint(TRUNCATE);") // checkpoint WAL
	sqlite.exec("pragma vacuum;") // vacuum
	sqlite.exec("pragma analysis_limit = 0;") // complete scan to generate sqlite_stat4
	sqlite.exec("pragma optimize;") // optimize
	sqlite.exec("analyze;") // run opt
	sqlite.exec("pragma journal_mode = DELETE;") // delete wal
	sqlite.close() // close the db
	console.log('db: closed')
}

atexit_last(db_close)
