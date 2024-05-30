import { drizzle } from 'drizzle-orm/bun-sqlite'
import { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite'
import { Database } from 'bun:sqlite'
import * as schema from './schema'
import { fs_sqlite } from './fs'
import { atexit_last } from './atexit'
import { $ } from 'bun'

export const sqlite: Database = new Database(fs_sqlite, { create: false, readwrite: true })

//sqlite.exec("pragma locking_mode = EXCLUSIVE;") // exclusive locking
sqlite.exec("pragma journal_mode = WAL;")
sqlite.exec("pragma synchronous = normal;") // safe with WAL
sqlite.exec("pragma temp_store = memory;")
sqlite.exec("pragma mmap_size = 30000000000;")
//sqlite.exec("pragma auto_vacuum = incremental;") // TODO: needs to be set at db creation before tables, so why call it here?
sqlite.loadExtension("./chromaprint/ext")

export const db: BunSQLiteDatabase<typeof schema> = drizzle(sqlite, { schema, logger: false })

export async function db_close() {
	if (sqlite.inTransaction) {
		sqlite.exec("rollback")
		console.log('db: rolled back')
	}

	// only one process
	if (await lsof_db()) {
		sqlite.exec("pragma wal_checkpoint(TRUNCATE);") // checkpoint WAL
		sqlite.exec("pragma vacuum;") // vacuum
		sqlite.exec("pragma analysis_limit = 0;") // complete scan to generate sqlite_stat4
		sqlite.exec("pragma optimize;") // optimize
		sqlite.exec("analyze;") // run opt
		sqlite.exec("pragma journal_mode = DELETE;") // delete wal
		console.log('db: cleanup')	
	}

	sqlite.close() // close the db
	console.log('db: closed')
}

atexit_last(db_close)

export async function lsof_db(): Promise<boolean> {
	const pid = process.pid

	const lsof = $`lsof -t ${fs_sqlite}`.lines()
	const pids = (await Array.fromAsync(lsof)).filter(x => x !== pid.toString())

	return pids.length === 0
}
