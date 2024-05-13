import open from "open"
import { _manual_cleanup, atexit } from "./atexit"
import { pass } from "./pass"
import { seed_root } from './seed'
import { serve_ui } from "./ui/ui"

const directive = process.argv[2]

if (directive === 'ui') {
	serve_ui()
}

if (directive === 'ui_show') {
	serve_ui()
	await open('http://localhost:3000')
} else {
	try {
		await seed_root()
	
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
	} catch (e) {
		console.error(e)
		_manual_cleanup() // TODO: bun doesn't support process.on('uncaughtException', ...)
	}
}
