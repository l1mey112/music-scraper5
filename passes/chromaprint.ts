import { $ } from "bun"
import { ident_cmd_unwrap_new, queue_complete, queue_pop, run_with_concurrency_limit } from "../pass_misc"
import { FSRef } from "../types"
import { fs_hash_path } from "../fs"
import { db } from "../db"
import { $source } from "../schema"
import { sql } from "drizzle-orm"

// source.classify.chromaprint
export async function pass_source_classify_chromaprint() {
	let updated = false
	const k = queue_pop<FSRef>('source.classify.chromaprint')

	if (k.length === 0) {
		return
	}

	await run_with_concurrency_limit(k, 20, async (entry) => {
		const hash = entry.payload
		// const [ident, track_id] = ident_cmd_unwrap_new(entry, 'track_id')

		// defualt length is 120 seconds, 180 is fine
		const fpcalc = await $`fpcalc -algorithm 2 -length 180 -raw -json ${fs_hash_path(hash)}`.quiet()

		type FpCalc = {
			duration: number
			fingerprint: number[]
		}

		// rare
		if (fpcalc.exitCode !== 0) {
			throw new Error(`fpcalc failed: ${fpcalc.stderr}`)
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
		updated = true
	})
}
