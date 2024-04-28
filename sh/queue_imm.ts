#!/usr/bin/env bun

import { db_close } from "../db";
import { queue_dispatch_immediate } from "../pass_misc";
import { QueueCmd } from "../types";

const cmds = process.argv.slice(2)

if (cmds.length % 2 !== 0) {
	console.error('usage: ./queue_imm.ts (<cmd> <payload>)+')
	process.exit(1)
}

for (let i = 0; i < cmds.length; i += 2) {
	const cmd = cmds[i]
	const payload = cmds[i + 1]
	queue_dispatch_immediate(cmd as QueueCmd, payload)
}

db_close()
