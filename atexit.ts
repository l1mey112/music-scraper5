import { MaybePromise } from "./types"

// async atexit implementation

// beforeExit and signals can be called multiple times
let exiting = false

const atexits: (() => MaybePromise<void>)[] = []
const atexits_last: (() => MaybePromise<void>)[] = []

export function _manual_cleanup(signal?: string) {
	if (exiting) {
		return
	}

	exiting = true

	Promise.all(atexits.map(cb => cb())).finally(() => {
		Promise.all(atexits_last.map(cb => cb())).finally(() => {
			if (signal) {
				process.exit(1)
			}
		})
	})
}

const sigs = ['SIGINT', 'SIGUSR1', 'SIGUSR2', 'SIGTERM'] as const

sigs.forEach(sig => {
	process.on(sig, () => _manual_cleanup(sig))
})

process.on('beforeExit', _manual_cleanup)
process.on('uncaughtException', _manual_cleanup)
process.on('unhandledRejection', _manual_cleanup)

export function atexit(cb: () => void) {
	atexits.push(cb)
}

export function atexit_last(cb: () => void) {
	atexits_last.push(cb)
}
