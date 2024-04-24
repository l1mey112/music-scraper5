#!/usr/bin/env bun

import { $ } from 'bun'
import { suffix } from 'bun:ffi'
import fs from 'fs'

// auto recompile script for sqlite extension

const so = `chromaprint.${suffix}`

const c_stat = fs.statSync("chromaprint.c")
const so_stat = fs.statSync(so, { throwIfNoEntry: false })

if (!so_stat || so_stat.atimeMs - c_stat.atimeMs < 0) {
	console.log(`${so}: recompiling`)
	await $`cc -fPIC -shared -march=native -O3 chromaprint.c -o ${so}`
}
