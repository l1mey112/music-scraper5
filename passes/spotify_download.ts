import { $ } from "bun"
import { pass_zotify_credentials } from "../cred"
import { fs_media_path, fs_sharded_path_noext_nonlazy } from "../fs"
import { ident_cmd_unwrap_new, queue_complete, queue_dispatch_immediate, queue_pop, queue_retry_later, run_with_concurrency_limit } from "../pass_misc"
import { dirname, basename } from 'path'
import { FSRef } from "../types"
import { $source, $spotify_track } from "../schema"
import { db, sqlite } from "../db"
import { sql } from "drizzle-orm"

const has_audio_source = sqlite.prepare<number, [string]>(`
	select 1
	from spotify_track
	where id = ? and source is not null
`)

// source.download.from_spotify_track
export async function pass_source_download_from_spotify_track() {
	let updated = false
	const k = queue_pop<string>('source.download.from_spotify_track')

	if (k.length === 0) {
		return
	}

	const [username, password] = pass_zotify_credentials()

	await run_with_concurrency_limit(k, 20, async (entry) => {
		const spotify_id = entry.payload
		const [ident, track_id] = ident_cmd_unwrap_new(entry, 'track_id')

		const already_has_source = has_audio_source.get(spotify_id)
		if (already_has_source) {
			return
		}

		const [path, hash_part] = fs_sharded_path_noext_nonlazy()

		// strip out db/xx
		//           ^^^
		// root: db/
		// path: xx/??
		const file = path.slice(fs_media_path.length + 1)

		try {
			// 160kbps (highest for free users)
			const sh = await $`zotify --download-quality high --print-download-progress False --print-progress-info False --download-lyrics False --download-format ogg --root-path ${fs_media_path} --username ${username} --password ${password} --output ${file + '.ogg'} ${'https://open.spotify.com/track/' + spotify_id}`
			// sometimes zotify doesn't return nonzero exit code on failure
			if (sh.stderr.length > 0) {
				throw new Error(new TextDecoder().decode(sh.stderr))
			}
		} catch (e) {
			console.error('failed to download track', spotify_id)
			console.error(e)
			queue_retry_later(entry)
			return
		}

		const hash = (hash_part + '.ogg') as FSRef

		db.transaction(db => {
			db.insert($source)
				.values({
					hash,
					track_id,
					bitrate: 160000, // 160kbps
				})
				.run()

			db.update($spotify_track)
				.set({ source: hash })
				.where(sql`id = ${spotify_id}`)
				.run()
				
			queue_dispatch_immediate('source.classify.chromaprint', hash, ident) // ident is ignored
			queue_complete(entry)
		})
		updated = true
	})

	return updated
}
