import { db } from "./db";
import { fs_root } from "./fs";
import { queue_dispatch_seed } from "./pass_misc";
import { PassIdentifier } from "./types";

const glob = new Bun.Glob('*.*.*')

for (const file of glob.scanSync(fs_root)) {
	const fp = `${fs_root}/${file}`

	// i would like a lines() API bun.
	const text = await Bun.file(fp).text()

	const lines = text.split('\n')

	db.transaction(db => {
		// list of payloads separated by line
		for (const line of lines) {
			if (line.length === 0) {
				continue
			}

			queue_dispatch_seed(file as PassIdentifier, line)
		}
	})

	console.log(`seeded queue: ${file} (${lines.length})`)
}
