#!/usr/bin/env bun

import { createInterface } from 'readline'
import { db_close, sqlite } from '../db'
import { Statement } from 'bun:sqlite'

// take in a comma separated list, append to table

const table = process.argv[2]

if (!table) {
	console.error('usage: ./seed_cred.ts <table>')
	process.exit(1)
}

const rl = createInterface({
	input: process.stdin,
	output: process.stdout,
	terminal: false,
})

let stmt: Statement | undefined

sqlite.exec('begin')

rl.on('line', (line) => {
	if (line === '') {
		return
	}

	const components = line.split(',')

	if (!stmt) {
		switch (table) {
			case 'spotify_user': {
				stmt = sqlite.prepare(`
					insert into "cred_${table}" (username, password) values (?, ?)
				`)
				break
			}
			default: {
				console.error('unknown table', table)
				rl.close()
				return
			}
		}
	}

	if (components.length != stmt.paramsCount) {
		console.error(`expected ${stmt.paramsCount} columns, got ${components.length}`)
		rl.close()
	}

	stmt.run(components)
})

rl.once('close', () => {
	// end of input
	sqlite.exec('commit')
	db_close()
})
