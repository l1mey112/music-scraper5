import { db_close } from "./db";
import { PassMutationFn, PassStateEnum, pass, pass_state_tostring } from "./pass";
import { pass_track_new_spotify_index_liked } from "./passes/spotify_liked";
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

let lasttime: number = 0

const cb: PassMutationFn = (state, error) => {
	if (error) {
		console.error(`${error.pass ?? 'pass'}: ${error.message}`)
		if (error.throwable) {
			throw error.throwable
		}
		return
	}

	if (state.state == PassStateEnum.BeforeRunning) {
		lasttime = performance.now()
	}

	if (state.state == PassStateEnum.FinishedRunning) {
		// null name means finished group
		if (state.current_pass_name) {
			const timems = performance.now() - lasttime
			console.log(`finished: ${state.current_pass_name} in`, Math.round(timems), 'ms')
		}
	}
}

//await pass_track_new_spotify_index_liked()
await pass(cb)

exit()
