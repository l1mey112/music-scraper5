import { existsSync, mkdirSync, statSync } from "fs"
import { resolve } from "path"
import { FSRef } from "./types"
import { BunFile } from "bun"
import { nanoid } from "./ids"

export const fs_media_path = resolve("db")

if (!existsSync(fs_media_path)) {
	mkdirSync(fs_media_path)
} else if (!statSync(fs_media_path).isDirectory()) {
	console.error(`media directory exists but is not a directory (at ${fs_media_path})`)
	process.exit(1)
}

export function fs_hash_path(hash: FSRef): string {
	const shard = (hash as unknown as string).slice(0, 2)
	return `${fs_media_path}/${shard}/${hash}`
}

export function fs_sharded_lazy_bunfile(dot_ext: string): [BunFile, FSRef] {
	const [path, hash] = fs_sharded_path(dot_ext)
	return [Bun.file(path), hash]
}

export function fs_sharded_path(dot_ext: string): [string, FSRef] {
	const hash = (nanoid() + dot_ext) as FSRef
	const shard = hash.slice(0, 2)

	// bun automatically creates folders
	return [`${fs_media_path}/${shard}/${hash}`, hash]
}

// append your own extension
// creates the shard folder
export function fs_sharded_path_noext_nonlazy(): [string, string] {
	const hash = String(nanoid())
	const shard = hash.slice(0, 2)

	mkdirSync(`${fs_media_path}/${shard}`, { recursive: true })

	return [`${fs_media_path}/${shard}/${hash}`, hash]
}

export function fs_sharded_path_nonlazy(dot_ext: string): [string, FSRef] {
	const hash = (nanoid() + dot_ext) as FSRef
	const shard = hash.slice(0, 2)

	mkdirSync(`${fs_media_path}/${shard}`, { recursive: true })

	// bun automatically creates folders
	return [`${fs_media_path}/${shard}/${hash}`, hash]
}
