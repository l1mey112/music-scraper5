import { db } from "./db";
import { fs_root } from "./fs";
import { queue_dispatch_seed, queue_known_pass } from "./pass_misc";
import { PassIdentifier } from "./types";

const indexto: Record<string, [PassIdentifier, boolean]> = {
	'youtube_video.index': ['track.new.youtube_video', false],
	'youtube_channel.index': ['artist.new.youtube_channel', true],
}

for (const index in indexto) {
	const pass_entry = indexto[index]

	const fp = `${fs_root}/${index}`

	const file = Bun.file(fp)

	if (!await file.exists()) {
		continue
	}

	// i would like a lines() API bun.
	const text = await file.text()
	const lines = text.split('\n')

	db.transaction(db => {
		// list of payloads separated by line
		for (let line of lines) {
			line = line.split('#', 1)[0]
			line.trim()

			if (line.length === 0) {
				continue
			}

			const [main, supp] = pass_entry

			if (supp) {
				line = '*' + line
			}

			queue_dispatch_seed(main, line)
		}
	})

	console.log(`seed queue: ${pass_entry} (${lines.length})`)
}