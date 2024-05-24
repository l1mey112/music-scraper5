import { _manual_cleanup } from "./atexit"
import { pass } from "./pass"
import { assert, merge } from "./pass_misc"
import { ArtistId, TrackId } from "./types"
import { serve_ui } from "./ui/ui"

const directive = process.argv[2]

if (directive === 'ui') {
	serve_ui()
}

try {
	merge('artist_id', 54896449024832 as ArtistId, 54896125278304 as ArtistId)
	
	assert(false)
	if (directive === 'ui_serve') {
		serve_ui()
	} else {
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
	}
} catch (e) {
	console.error(e)
	_manual_cleanup() // TODO: bun doesn't support process.on('uncaughtException', ...)
}
