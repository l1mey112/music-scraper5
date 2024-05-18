#!/usr/bin/env bun

import { queue_dispatch_immediate, queue_known_pass } from "../pass";

const cmds = process.argv.slice(2)

if (cmds.length % 2 !== 0) {
	console.error('usage: ./queue_imm.ts (<cmd> <payload>)+')
	process.exit(1)
}

for (let i = 0; i < cmds.length; i += 2) {
	const cmd = cmds[i]
	const payload = cmds[i + 1]
	if (!queue_known_pass(cmd)) {
		console.error(`unknown pass: ${cmd}`)
		process.exit(1)
	}
	queue_dispatch_immediate(cmd, payload as any)
}
