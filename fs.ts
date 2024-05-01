import { existsSync, mkdirSync, statSync } from "fs"
import { resolve } from "path"
import { FSRef } from "./types"
import { BunFile } from "bun"
import { shard_id } from "./ids"

if (!process.argv[2]) {
	console.error("no root directory provided")
	process.exit(1)
}

export const fs_root = resolve(process.argv[2])

console.log(`root directory: ${fs_root}`)

if (!existsSync(fs_root)) {
	mkdirSync(fs_root)
} else if (!statSync(fs_root).isDirectory()) {
	console.error(`root directory exists but is not a directory (at ${fs_root})`)
	process.exit(1)
}

export function fs_hash_path(hash: FSRef): string {
	const shard = (hash as unknown as string).slice(0, 2)
	return `${fs_root}/${shard}/${hash}`
}

export function fs_sharded_lazy_bunfile(dot_ext: string): [BunFile, FSRef] {
	const [path, hash] = fs_sharded_path(dot_ext)
	return [Bun.file(path), hash]
}

export function fs_sharded_path(dot_ext: string): [string, FSRef] {
	const hash = (shard_id() + dot_ext) as FSRef
	const shard = hash.slice(0, 2)

	// bun automatically creates folders
	return [`${fs_root}/${shard}/${hash}`, hash]
}

// append your own extension
// creates the shard folder
export function fs_sharded_path_noext_nonlazy(): [string, string] {
	const hash = String(shard_id())
	const shard = hash.slice(0, 2)

	mkdirSync(`${fs_root}/${shard}`, { recursive: true })

	return [`${fs_root}/${shard}/${hash}`, hash]
}

export function fs_sharded_path_nonlazy(dot_ext: string): [string, FSRef] {
	const hash = (shard_id() + dot_ext) as FSRef
	const shard = hash.slice(0, 2)

	mkdirSync(`${fs_root}/${shard}`, { recursive: true })

	// bun automatically creates folders
	return [`${fs_root}/${shard}/${hash}`, hash]
}
