#!/usr/bin/env bun

import { sql } from "drizzle-orm"
import { db } from "../db"
import { pass_hash, queue_known_pass } from "../pass"
import { $queue } from "../schema"

const cmd = process.argv[2]

if (!cmd) {
	console.error('usage: ./kill_expiry.ts <pass ident>')
	process.exit(1)
}

if (!queue_known_pass(cmd)) {
	console.error(`unknown pass: ${cmd}`)
	process.exit(1)
}

const { count } = db.select({ count: sql<number>`count(*)` })
	.from($queue)
	.where(sql`pass = ${pass_hash(cmd)}`)
	.get()!

console.log(count)
