import { db_close } from "./db";
import { pass } from "./pass";
import { pass_aux_index_spotify_liked } from "./passes/spotify_liked";
import './seed' // seed the queue

function exit() {
	db_close()
	process.exit(0)
}

// for some reason, beforeExit is not being called
// it only works on a forced `process.exit(0)`
// TODO: raise this as an issue to bun
//       bun doesn't catch these signals
process.on("SIGINT", exit)
process.on("SIGTERM", exit)

for await (const status of pass()) {
	switch (status.kind) {
		case 'before': {
			process.stdout.write(`\r${status.pass}...`)
			break
		}
		case 'after': {
			process.stdout.write(`\r${status.pass}... ${Math.round(status.msec)}ms\n`)
			break
		}
		case 'error': {
			let msg = status.pass ? `\r${status.pass}: error` : 'error:'
			console.error(msg, status.error)
			if (status.throwable) {
				throw status.throwable
			}
		}
	}
}

//await pass_track_new_spotify_index_liked()

exit()
