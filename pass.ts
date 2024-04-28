import { MaybePromise, PassIdentifier } from "./types"
import { passes } from "./passes"

class PassStopException extends Error {
	constructor(message: string) {
		super(message)
	}
}

const TRIP_COUNT_MAX = 20

type PassState = {
	state: PassStateEnum
	single_step: boolean
	current_pass: PassGroupState
	current_pass_name: string | null
	parent_pass: PassGroupState
}

type PassGroupState = {
	parent?: PassGroupState | undefined
	idx: number
	breakpoints: Set<number>
	mutations: Set<number>
	trip_count: number
	blocks: PassElementState[]
}

type PassElementState = PassGroupState | PassBlock

function walk_passes(blocks: PassElement[], parent?: PassGroupState): PassGroupState {
	const state: PassGroupState = {
		idx: 0,
		breakpoints: new Set(),
		mutations: new Set(),
		trip_count: 0,
		parent,
		blocks: [],
	}

	for (const block of blocks) {
		if (block instanceof Array) {
			state.blocks.push(walk_passes(block, state))
		} else {
			state.blocks.push(block)
		}
	}

	return state
}

type PassBlock = {
	name: PassIdentifier // split('.', 3)
	fn: () => MaybePromise<boolean | void>
}

export type PassElement = PassElement[] | PassBlock

type PassError = {
	pass?: PassIdentifier,
	message: string
	throwable?: any
}

export enum PassStateEnum {
	BeforeRunning,
	FinishedRunning,
	PendingStop,
	Stopped,
	Finished,
}

let pass_state: PassState = {
	state: PassStateEnum.Stopped,
	single_step: false,
	current_pass: walk_passes(passes),
	current_pass_name: null,
	parent_pass: undefined as any
}

pass_state.parent_pass = pass_state.current_pass

// Running, Finished -> ReadyNext
//
// ReadyNext -> Running -> ReadyNext (run pass)
//                state := idx++
//
// ReadyNext (single_step) -> Stopped
// ReadyNext (breakpoint on idx) -> Stopped
//
// Running (user action) -> PendingStop
// PendingStop, ReadyNext -> Stopped
//
// ReadyNext, Stopped (end + !mutation) -> Finished
//
// Stopped, Finished -> ReadyNext (run button)

// AfterRunning -> ReadyNext -> Running

let inside_pass_job = false

async function state_machine(): Promise<PassError | undefined> {
	// default state should be Running

	switch (pass_state.state) {
		case PassStateEnum.PendingStop:
		case PassStateEnum.Finished:
		case PassStateEnum.Stopped:
		case PassStateEnum.FinishedRunning: {
			pass_state.current_pass_name = null // unset name
			
			if (pass_state.current_pass.idx >= pass_state.current_pass.blocks.length) {
				pass_state.current_pass.idx = 0

				if (pass_state.current_pass.mutations.size == 0) {
					pass_state.current_pass.trip_count = 0

					if (pass_state.current_pass.parent) {
						pass_state.current_pass = pass_state.current_pass.parent
						pass_state.current_pass.idx++
						// needs to check for breakpoints, will come back here
						if (pass_state.state != PassStateEnum.PendingStop) {
							pass_state.state = PassStateEnum.FinishedRunning
						}
						return
					} else {
						pass_state.state = PassStateEnum.Finished
					}
					return
				}

				pass_state.current_pass.trip_count++

				if (pass_state.current_pass.trip_count >= TRIP_COUNT_MAX) {
					pass_state.state = PassStateEnum.Finished
					pass_state.current_pass.trip_count = 0
					return {
						message: `forward progress trip count exceeded max of ${TRIP_COUNT_MAX}`
					}
				}
			}

			if (pass_state.current_pass.idx == 0) {
				pass_state.current_pass.mutations.clear()
			}

			// recursively enter the next pass
			let pass
			do {
				pass = pass_state.current_pass.blocks[pass_state.current_pass.idx]
				if ('blocks' in pass) {
					pass_state.current_pass = pass
				}
			} while ('blocks' in pass)

			if (pass_state.state == PassStateEnum.PendingStop) {
				pass_state.state = PassStateEnum.Stopped
				return
			}

			// single step or breakpoint
			if (pass_state.state != PassStateEnum.Finished && pass_state.state != PassStateEnum.Stopped) {
				if (pass_state.single_step || pass_state.current_pass.breakpoints.has(pass_state.current_pass.idx)) {
					pass_state.state = PassStateEnum.Stopped
					return
				}
			}
			pass_state.state = PassStateEnum.BeforeRunning
			break
		}
		case PassStateEnum.BeforeRunning: {
			const pass = pass_state.current_pass.blocks[pass_state.current_pass.idx] as PassBlock
			pass_state.current_pass_name = pass.name // set name

			try {
				if (await pass.fn()) {
					pass_state.current_pass.mutations.add(pass_state.current_pass.idx)
				}
			} catch (e) {
				pass_state.state = PassStateEnum.Stopped
				let message = `exception thrown`
				let throwable = e
				if (e instanceof PassStopException) {
					message = `exception thrown: ${e.message}`
					throwable = undefined
				}
				return {
					pass: pass.name,
					message,
					throwable,
				}
			}

			pass_state.current_pass.idx++

			// typescript narrowing has no idea about other functions and their side effects
			if ((pass_state.state as PassStateEnum) != PassStateEnum.PendingStop) {
				pass_state.state = PassStateEnum.FinishedRunning
			}
			break
		}
	}
}

function pass_walk_reset(state: PassGroupState) {
	state.idx = 0
	state.mutations.clear()
	for (const block of state.blocks) {
		if ('blocks' in block) {
			pass_walk_reset(block)
		}
	}
}

export type PassMutationFn = (state: PassState, error?: PassError) => MaybePromise<void>

export async function pass(mutation: PassMutationFn) {
	if (pass_state.state == PassStateEnum.BeforeRunning) {
		return
	}

	if (inside_pass_job) {
		return
	}

	if (pass_state.state == PassStateEnum.Finished) {
		pass_state.current_pass = pass_state.parent_pass
		pass_walk_reset(pass_state.current_pass)
	}

	inside_pass_job = true

	do {
		const error = await state_machine()
		await mutation(pass_state, error)
	} while ((pass_state.state as PassStateEnum) != PassStateEnum.Finished && (pass_state.state as PassStateEnum) != PassStateEnum.Stopped)

	inside_pass_job = false
}

// must be called inside a pass, throws an exception
export function pass_exception(message: string): never {
	throw new PassStopException(message)
}

export function pass_state_tostring(v: PassStateEnum) {
	switch (v) {
		case PassStateEnum.BeforeRunning: return 'Running'
		case PassStateEnum.FinishedRunning: return 'ReadyNext'
		case PassStateEnum.PendingStop: return 'PendingStop'
		case PassStateEnum.Stopped: return 'Stopped'
		case PassStateEnum.Finished: return 'Finished'
	}
}
