import { PassMutationFn, PassStateEnum, pass, pass_state_tostring } from "./pass";

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
		const timems = performance.now() - lasttime
		console.log(`finished: ${state.current_pass_name} in`, Math.round(timems), 'ms')
	}
}

await pass(cb)
