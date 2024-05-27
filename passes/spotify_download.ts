import { $ } from "bun"
import { fs_hash_delete, fs_hash_exists_some, fs_media, fs_sharded_path_noext_nonlazy } from "../fs"
import { FSRef, QueueEntry } from "../types"
import { $source, $spotify_track } from "../schema"
import { db, sqlite } from "../db"
import { get_ident, has_preferable_source, run_with_concurrency_limit } from "../pass_misc"
import { queue_complete, queue_dispatch_immediate, queue_retry_failed } from "../pass"
import { spotify_user_cred } from "../cred"

// if contains no preview, then it's not available
const can_download_source = sqlite.prepare<number, [string]>(`
	select 1
	from spotify_track
	where id = ? and preview_url is not null
`)

// source.download_from_spotify_track
export function pass_source_download_from_spotify_track(entries: QueueEntry<string>[]) {
	return run_with_concurrency_limit(entries, 32, async (entry) => {
		const spotify_id = entry.payload
		const [_, track_id] = get_ident(spotify_id, $spotify_track, 'track_id')

		// 160kbps on spotify is the highest quality for free users
		if (has_preferable_source(track_id, 160)) {
			console.log('skipping spotify track download, already have a source')
			queue_complete(entry)
			return
		}

		if (!can_download_source.get(spotify_id)) {
			queue_complete(entry)
			return
		}

		const [path, hash_part] = fs_sharded_path_noext_nonlazy()

		// strip out db/xx
		//           ^^^
		// root: db/
		// path: xx/??
		const file = path.slice(fs_media.length + 1)

		const cred = spotify_user_cred.roll()
		const { username, password } = cred

		// INFO: you know, from what i can tell, it isn't spotify throttling us. they're absolutely oblivious.
		//       no harm to the people at zotify, but it is zotify itself which is shitting the bed.

		fail: {
			// 160kbps (highest for free users)
			const sh = await $`zotify --download-quality high --print-download-progress False --print-progress-info False --download-lyrics False --download-format ogg --save-credentials False --root-path ${fs_media} --username ${username} --password ${password} --output ${file + '.ogg'} ${'https://open.spotify.com/track/' + spotify_id}`
				.quiet()
				.nothrow()

			// TODO: should possibly just complete the queue entry and leave the track with no source
			if (sh.stdout.includes('SONG IS UNAVAILABLE')) {
				// doesn't exist
				queue_retry_failed(entry, 'SONG IS UNAVAILABLE')
				return
			}

			// error is regular occurance
			if (sh.stderr.includes('OSError: [Errno 9] Bad file descriptor') || sh.stderr.includes('Failed reading packet!')) {
				console.error('bad file descriptor for', spotify_id)
				break fail
			}
			if (sh.stderr.includes('GENERAL DOWNLOAD ERROR') || sh.stdout.includes('GENERAL DOWNLOAD ERROR')) {
				console.error('general download error for', spotify_id)
				break fail
			}
			if (sh.stdout.includes('SKIPPING SONG - FAILED TO QUERY METADATA') || sh.stderr.includes('SKIPPING SONG - FAILED TO QUERY METADATA')) {
				console.error('failed to query metadata for', spotify_id)
				break fail
			}
			if (sh.stderr.includes('OSError') || sh.stdout.includes('OSError')
				|| sh.stderr.includes('Remote end closed connection without response') || sh.stdout.includes('Remote end closed connection without response')
				|| sh.stderr.includes('Connection reset by peer') || sh.stdout.includes('Connection reset by peer')) {
				console.error('os error for', spotify_id)
				break fail
			}
			if (sh.stderr.includes('Audio key error') || sh.stdout.includes('Audio key error')) {
				console.error('audio key error for', spotify_id)
				break fail
			}
			if (sh.stderr.includes('BadCredentials') || sh.stdout.includes('BadCredentials')) {
				console.error('bad credentials for', username, password)
				spotify_user_cred.kill(cred)
				return
			}

			// python catches SIGINT for us (non-propagation) and returns 130
			// this process has to die as intended

			// if KeyboardInterrupt is left unhandled, it should reraise the signal, but python doesn't do that
			// probably for selfish cosmetic reasons - python doesn't play nice when embedded
			if (sh.exitCode === 130) {
				process.kill(process.pid, "SIGINT")
			}

			// going to retry, possibly another python error 10000000 times down the callstack
			if (sh.exitCode !== 0 || sh.stderr.length > 0 || sh.stdout.length > 0) {
				console.error('failed to download track', spotify_id, 'exit code', sh.exitCode)
				console.error(sh.stdout.toString())
				console.error(sh.stderr.toString())
				break fail
			}

			console.log('downloaded', spotify_id)

			const hash = (hash_part + '.ogg') as FSRef

			if (!fs_hash_exists_some(hash)) {
				fs_hash_delete(hash)
				console.error('downloaded file does not exist ????', hash)
				break fail
			}

			db.transaction(db => {
				db.insert($source)
					.values({
						hash,
						track_id,
						bitrate: 160, // 160kbps
					})
					.run()

				queue_dispatch_immediate('source.classify_chromaprint', hash)
				queue_complete(entry)
			})
			return
		}
		spotify_user_cred.ban(cred, 10_000)
	})
}
