import { existsSync, mkdirSync, statSync, unlinkSync } from "fs"
import { realpathSync } from "fs"
import { FSRef } from "./types"
import { BunFile } from "bun"
import { shard_id, shard_part } from "./ids"

function assert_directory(path: string, kind: string) {
	if (!existsSync(path)) {
		mkdirSync(path)
	} else if (!statSync(path).isDirectory()) {
		console.error(`${kind} directory exists but is not a directory (at ${fs_root})`)
		process.exit(1)
	}
}

export const fs_root = realpathSync('root')
export const fs_sqlite = `${fs_root}/db.sqlite`
export const fs_wal = `${fs_root}/wal.log`
export const fs_media = `${fs_root}/media`

assert_directory(fs_root, "root")
assert_directory(fs_media, "media")

// tilde expansion
export function unwrap_path(path: string) {
	const home = process.env.HOME
	return home ? path.replace(/^~(?=$|\/|\\)/, home) : path
}

export function fs_root_path(path: string): string {
	return `${fs_root}/${path}`
}

export function fs_hash_path(hash: FSRef): string {
	return `${fs_media}/${shard_part(hash)}/${hash}`
}

// return if exists and has at least one byte
export function fs_hash_exists_some(hash: FSRef): boolean {
	if (!existsSync(fs_hash_path(hash))) {
		return false
	}

	const stat = statSync(fs_hash_path(hash))
	return stat.size > 0
}

export function fs_hash_delete(hash: FSRef) {
	if (!fs_hash_exists_some(hash)) {
		return
	}

	unlinkSync(fs_hash_path(hash))
}

export function fs_sharded_lazy_bunfile(dot_ext: string): [BunFile, FSRef] {
	const [path, hash] = fs_sharded_path(dot_ext)
	return [Bun.file(path), hash]
}

export function fs_sharded_path(dot_ext: string): [string, FSRef] {
	const hash = (shard_id() + dot_ext) as FSRef
	// bun automatically creates folders
	return [`${fs_media}/${shard_part(hash)}/${hash}`, hash]
}

// append your own extension
// creates the shard folder
export function fs_sharded_path_noext_nonlazy(): [string, string] {
	const hash = shard_id()
	const shard = shard_part(hash)

	mkdirSync(`${fs_media}/${shard}`, { recursive: true })

	return [`${fs_media}/${shard}/${hash}`, hash]
}

export function fs_sharded_path_nonlazy(dot_ext: string): [string, FSRef] {
	const hash = (shard_id() + dot_ext) as FSRef
	const shard = shard_part(hash)

	mkdirSync(`${fs_media}/${shard}`, { recursive: true })

	// bun automatically creates folders
	return [`${fs_media}/${shard}/${hash}`, hash]
}
