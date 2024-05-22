import { $ } from "bun"
import { FSRef, QueueEntry } from "../types"
import { fs_hash_path } from "../fs"
import { db } from "../db"
import { $source } from "../schema"
import { sql } from "drizzle-orm"
import { assert, run_with_concurrency_limit } from "../pass_misc"
import { queue_complete } from "../pass"
import { wal_log, wal_pass_fatal } from "../wal"

// source.classify_chromaprint
export function pass_source_classify_chromaprint(entries: QueueEntry<FSRef>[]) {
	return run_with_concurrency_limit(entries, 20, async (entry) => {
		const hash = entry.payload
		const path = fs_hash_path(hash)

		// default length is 120 seconds, 180 is fine
		const fpcalc = await $`fpcalc -algorithm 2 -length 180 -raw -json ${path}`.quiet().nothrow()

		type FpCalc = {
			duration: number
			fingerprint: number[]
		}

		// rare
		if (fpcalc.exitCode !== 0) {
			if (fpcalc.stderr.includes('Empty fingerprint')) {
				queue_complete(entry) // don't retry
				return
			}

			// won't need again, unless everything breaks
			/* if (!await Bun.file(path).exists()) {
				// oh my god, delete this and everything about it

				db.transaction(db => {
					db.delete($source)
						.where(sql`hash = ${hash}`)
						.run()
					queue_complete(entry)
					wal_log(`hash ${hash} does not exist, deleting`, entry)
				})
				return
			} */

			// this shouldn't fail
			assert(false, `fpcalc failed(${entry.payload}): ${fpcalc.stderr}`)
		}

		const json: FpCalc = fpcalc.json()
		const fingerprint = new Uint32Array(json.fingerprint)

		// https://wiki.musicbrainz.org/Guides/AcoustID

		// accuracy diminishes below 25 seconds (reported 15-30, intuition 20, meet in the middle of 25)
		// at least 80 unique items
		if (json.duration < 25 || new Set(fingerprint).size < 80) {
			queue_complete(entry) // don't retry
			return
		}

		db.transaction(db => {
			db.update($source)
				.set({ chromaprint: new Uint8Array(fingerprint.buffer), duration_s: json.duration })
				.where(sql`hash = ${hash}`)
				.run()

			queue_complete(entry)
		})
	})
}
