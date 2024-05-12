#!/usr/bin/env bun

import { fs_hash_path } from "../fs"
import { FSRef } from "../types"

const fs_ref = process.argv[2]

if (!fs_ref) {
	console.error('usage: ./media_path.ts <fs_ref>')
	process.exit(1)
}

console.log(fs_hash_path(fs_ref as FSRef))
