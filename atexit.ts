import { MaybePromise } from "./types"

// async atexit implementation

// beforeExit and signals can be called multiple times
let exiting = false

const atexits: (() => MaybePromise<void>)[] = []
const atexits_last: (() => MaybePromise<void>)[] = []

export function _manual_cleanup() {
	if (exiting) {
		return
	}

	exiting = true

	Promise.all(atexits.map(cb => cb())).finally(() => {
		Promise.all(atexits_last.map(cb => cb())).finally(() => {
			process.exit()
		})
	})
}

const sigs = ['SIGINT', 'SIGUSR1', 'SIGUSR2', 'SIGTERM', 'uncaughtException', 'unhandledRejection'] as const

sigs.forEach(sig => {
	process.on(sig, () => {
		process.exitCode = 1
		_manual_cleanup()
	})
})

process.on('beforeExit', _manual_cleanup)

// this does not play well at all with `process.exit()`, don't use it if you want anything here ran.

export function atexit(cb: () => void) {
	atexits.push(cb)
}

export function atexit_last(cb: () => void) {
	atexits_last.push(cb)
}
