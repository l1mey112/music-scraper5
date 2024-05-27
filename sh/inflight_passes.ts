#!/usr/bin/env bun

import { sql } from "drizzle-orm"
import { db } from "../db"
import { pass_hash, queue_known_pass } from "../pass"
import { $queue } from "../schema"
import { PassIdentifier, passes } from "../passes"

function pass_count(pass: PassIdentifier) {
	const { count } = db.select({ count: sql<number>`count(*)` })
		.from($queue)
		.where(sql`pass = ${pass_hash(pass)}`)
		.get()!

	const { count: ready_count } = db.select({ count: sql<number>`count(*)` })
		.from($queue)
		.where(sql`pass = ${pass_hash(pass)} and expiry <= ${Date.now()}`)
		.get()!

	return `${ready_count}/${count}`
}

const pass = process.argv[2]

// just go print them all
if (!pass) {
	for (const pass of Object.keys(passes)) {
		console.log(`${pass}:`, pass_count(pass as PassIdentifier))
	}
} else {
	if (!queue_known_pass(pass)) {
		console.error(`unknown pass: ${pass}`)
		process.exit(1)
	}

	console.log(pass_count(pass))
}
