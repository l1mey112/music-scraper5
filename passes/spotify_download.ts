import { $, ShellError } from "bun"
import { pass_zotify_credentials } from "../cred"
import { fs_media, fs_sharded_path_noext_nonlazy } from "../fs"
import { FSRef, QueueEntry } from "../types"
import { $source, $spotify_track } from "../schema"
import { db, sqlite } from "../db"
import { sql } from "drizzle-orm"
import { get_ident, run_with_concurrency_limit } from "../pass_misc"
import { queue_complete, queue_dispatch_immediate, queue_retry_failed } from "../pass"

// if contains no preview, then it's not available
const can_download_source = sqlite.prepare<number, [string]>(`
	select 1
	from spotify_track
	where id = ? and source is null and preview_url is not null
`)

// source.download_from_spotify_track
export function pass_source_download_from_spotify_track(entries: QueueEntry<string>[]) {
	const [username, password] = pass_zotify_credentials()

	return run_with_concurrency_limit(entries, 8, async (entry) => {
		const spotify_id = entry.payload
		const [_, track_id] = get_ident(spotify_id, $spotify_track, 'track_id')

		if (!can_download_source.get(spotify_id)) {
			return
		}

		const [path, hash_part] = fs_sharded_path_noext_nonlazy()

		// strip out db/xx
		//           ^^^
		// root: db/
		// path: xx/??
		const file = path.slice(fs_media.length + 1)

		try {
			// 160kbps (highest for free users)
			const sh = await $`zotify --download-quality high --print-download-progress False --print-progress-info False --download-lyrics False --download-format ogg --root-path ${fs_media} --username ${username} --password ${password} --output ${file + '.ogg'} ${'https://open.spotify.com/track/' + spotify_id}`

			// sometimes zotify doesn't return nonzero exit code on failure
			const stdout = sh.stdout.toString()
			if (stdout.includes('SONG IS UNAVAILABLE') || stdout.includes('SKIPPING')) {
				// doesn't exist
				queue_retry_failed(entry, 'SONG IS UNAVAILABLE')
				return
			}
			if (sh.stderr.length > 0) {
				throw new Error(sh.stderr.toString())
			}
		} catch (e) {
			// python catches SIGINT for us (non-propagation) and returns 130
			// this process has to die as intended

			// if KeyboardInterrupt is left unhandled, it should reraise the signal, but python doesn't do that
			// probably for selfish cosmetic reasons - python doesn't play nice when embedded

			// TODO: ShellError doesn't exist.
			//       even though its defined as a class, you can only use it as a type
			if ((e as object).hasOwnProperty('exitCode') && (e as ShellError).exitCode == 130) {
				process.kill(process.pid, "SIGINT")
			}

			console.error('failed to download track', spotify_id)
			console.error(e)
			queue_retry_failed(entry, `failed to download track ${spotify_id}`)
			return
		}

		const hash = (hash_part + '.ogg') as FSRef

		db.transaction(db => {
			db.insert($source)
				.values({
					hash,
					track_id,
					bitrate: 160, // 160kbps
				})
				.run()

			db.update($spotify_track)
				.set({ source: hash })
				.where(sql`id = ${spotify_id}`)
				.run()

			queue_dispatch_immediate('source.classify_chromaprint', hash)
			queue_complete(entry)
		})
	})
}
