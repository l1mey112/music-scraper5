import { existsSync, mkdirSync, statSync } from "fs"
import { resolve } from "path"
import { FSRef } from "./types"
import { BunFile } from "bun"
import { snowflake } from "./snowflake"

const media_db = resolve("db")

if (!existsSync(media_db)) {
	mkdirSync(media_db)
} else if (!statSync(media_db).isDirectory()) {
	console.error(`media directory exists but is not a directory (at ${media_db})`)
	process.exit(1)
}

export function fs_hash_path(hash: FSRef): string {
	const shard = (hash as unknown as string).slice(0, 2)
	return `${media_db}/${shard}/${hash}`
}

export function fs_sharded_lazy_bunfile(dot_ext: string): [BunFile, FSRef] {
	const [path, hash] = fs_sharded_path(dot_ext)
	return [Bun.file(path), hash]
}

export function fs_sharded_path(dot_ext: string): [string, FSRef] {
	const hash = (snowflake() + dot_ext) as FSRef
	const shard = hash.slice(0, 2)

	// bun automatically creates folders
	return [`${media_db}/${shard}/${hash}`, hash]
}

// append your own extension
// creates the shard folder
export function fs_sharded_path_noext_nonlazy(): [string, string] {
	const hash = String(snowflake())
	const shard = hash.slice(0, 2)

	mkdirSync(`${media_db}/${shard}`, { recursive: true })

	return [`${media_db}/${shard}/${hash}`, hash]
}

export function fs_sharded_path_nonlazy(dot_ext: string): [string, FSRef] {
	const hash = (snowflake() + dot_ext) as FSRef
	const shard = hash.slice(0, 2)

	mkdirSync(`${media_db}/${shard}`, { recursive: true })

	// bun automatically creates folders
	return [`${media_db}/${shard}/${hash}`, hash]
}
