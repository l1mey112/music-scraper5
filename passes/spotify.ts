import { sql } from "drizzle-orm"
import { pass_spotify_api } from "../cred"
import { db } from "../db"
import { locale_current } from "../locale"
import { ident_cmd_unwrap_new, locale_insert, queue_complete, queue_dispatch_immediate, queue_pop, queue_retry_later, run_batched_zip } from "../pass_misc"
import { Locale, LocaleDesc, LocaleEntry, QueueEntry } from "../types"
import { $spotify_track, $youtube_video } from "../schema"

// track.new.spotify_track
export async function pass_track_new_spotify_track() {
	let updated = false
	const k = queue_pop<string>('track.new.spotify_track')

	const api = pass_spotify_api()

	function batch_fn(entry: QueueEntry<string>[]) {
		return api.tracks.get(entry.map(it => it.payload))
	}

	// > A comma-separated list of the Spotify IDs. For example: ...
	// > Maximum: 100 IDs.

	// they lied here, it's 50

	await run_batched_zip(k, 50, batch_fn, (entry, track) => {
		// null (track doesn't exist), retry again later
		if (!track) {
			queue_retry_later(entry)
			return
		}

		const spotify_id = entry.payload
		const isrc: string | null | undefined = track.external_ids.isrc
		const [ident, track_id] = ident_cmd_unwrap_new(entry, 'track_id', { isrc })

		const spotify_album_id = track.album.id

		const name: LocaleEntry = {
			ident,
			locale: locale_current(), // assumed
			desc: LocaleDesc.name,
			text: track.name,
			preferred: true,
		}

		db.transaction(db => {
			queue_dispatch_immediate('album.new.spotify_album', spotify_album_id)
			for (const spotify_artist of track.artists) {
				queue_dispatch_immediate('artist.new.spotify_artist', spotify_artist.id)
			}

			locale_insert(name)

			db.run(sql`
				insert or replace into ${$spotify_track} (id, track_id, preview_url)
				values (${spotify_id}, ${track_id}, ${track.preview_url})
			`)

			if (spotify_id != track.id) {
				console.log('updating spotify track id', spotify_id, '->', track.id)
				db.run(sql`
					update or replace ${$spotify_track} set id = ${track.id}
					where id = ${spotify_id}
				`)
			}

			queue_complete(entry)
			updated = true
		})
	})

	return updated
}
