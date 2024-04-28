import { pass_spotify_api } from "../cred"
import { db } from "../db"
import { locale_current } from "../locale"
import { ident_cmd_unwrap_new, ident_id, images_queue_url, insert_album_artist, insert_album_track, insert_canonical, insert_track_artist, locale_insert, queue_complete, queue_dispatch_chain_returning, queue_pop, queue_retry_later, run_batched_zip, queue_dispatch_chain_immediate, queue_dispatch_immediate } from "../pass_misc"
import { ArtistId, ImageKind, LocaleDesc, LocaleEntry, QueueEntry, TrackId } from "../types"
import { $spotify_album, $spotify_artist, $spotify_track, $youtube_video } from "../schema"

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

		db.transaction(db => {
			const spotify_id = entry.payload
			const isrc: string | null | undefined = track.external_ids.isrc
			const [ident, track_id] = ident_cmd_unwrap_new(entry, 'track_id', { isrc })

			const spotify_album_id = track.album.id

			const name: LocaleEntry = {
				ident,
				desc: LocaleDesc.name,
				text: track.name,
				preferred: true,
			}

			queue_dispatch_chain_immediate('album.new.spotify_album', spotify_album_id)
			const artists = track.artists.map(it => {
				const ident = queue_dispatch_chain_returning('artist.new.spotify_artist', it.id)

				return ident_id<ArtistId>(ident)
			})
			insert_track_artist(track_id, artists)

			locale_insert(name)

			const data = {
				track_id,
				preview_url: track.preview_url,
			}

			insert_canonical($spotify_track, track.id, spotify_id, data)
			queue_dispatch_immediate('source.download.from_spotify_track', spotify_id, ident)
			queue_complete(entry)
		})
		updated = true
	})

	return updated
}

// album.new.spotify_album
export async function pass_album_new_spotify_album() {
	let updated = false
	const k = queue_pop<string>('album.new.spotify_album')

	const api = pass_spotify_api()

	function batch_fn(entry: QueueEntry<string>[]) {
		return api.albums.get(entry.map(it => it.payload))
	}

	await run_batched_zip(k, 20, batch_fn, async (entry, album) => {
		// null (track doesn't exist), retry again later
		if (!album) {
			queue_retry_later(entry)
			return
		}

		await db.transaction(async db => {
			const spotify_id = entry.payload
			const [ident, album_id] = ident_cmd_unwrap_new(entry, 'album_id')

			// most albums have < 50 tracks, the album request already provides us with enough
			// but in cases where it doesn't, we'll have to fetch the tracks separately

			const total_tracks = album.total_tracks
			const tracks = album.tracks.items

			if (album.tracks.total > total_tracks) {
				for (let offset = 50; tracks.length < total_tracks; offset += 50) {
					const next = await api.albums.tracks(album.id, undefined, 50, offset)
					console.log(`fetched ${next.items.length} tracks, total ${tracks.length + next.items.length} / ${total_tracks}`)
					tracks.push(...next.items)
				}
			}

			insert_album_track(album_id, tracks.map(it => {
				const ident = queue_dispatch_chain_returning('track.new.spotify_track', it.id)

				return ident_id<TrackId>(ident)
			}))

			const name: LocaleEntry = {
				ident,
				desc: LocaleDesc.name,
				text: album.name,
				preferred: true,
			}

			insert_album_artist(album_id, album.artists.map(it => {
				const ident = queue_dispatch_chain_returning('artist.new.spotify_artist', it.id)
	
				return ident_id<ArtistId>(ident)
			}))

			locale_insert(name)

			// > The cover art for the album in various sizes, widest first.
			const largest = album.images[0]
			images_queue_url(ident, ImageKind["Cover Art"], largest.url)

			insert_canonical($spotify_album, album.id, spotify_id, {
				album_id,
			})
	
			queue_complete(entry)
		})
		updated = true
	})

	return updated
}

// artist.new.spotify_artist
export async function pass_artist_new_spotify_artist() {
	let updated = false
	const k = queue_pop<string>('artist.new.spotify_artist')

	const api = pass_spotify_api()

	function batch_fn(entry: QueueEntry<string>[]) {
		return api.artists.get(entry.map(it => it.payload))
	}

	// > A comma-separated list of the Spotify IDs. For example: ...
	// > Maximum: 100 IDs.

	// they lied here AGAIN, it's 50

	await run_batched_zip(k, 50, batch_fn, (entry, artist) => {
		// null (track doesn't exist), retry again later
		if (!artist) {
			queue_retry_later(entry)
			return
		}

		db.transaction(db => {
			const spotify_id = entry.payload
			const [ident, artist_id] = ident_cmd_unwrap_new(entry, 'artist_id')

			const name: LocaleEntry = {
				ident,
				desc: LocaleDesc.name,
				text: artist.name,
				preferred: true,
			}

			locale_insert(name)

			// > The cover art for the artist in various sizes, widest first.
			const largest = artist.images[0]
			if (largest) {
				images_queue_url(ident, ImageKind["Profile Art"], largest.url)
			}

			insert_canonical($spotify_artist, artist.id, spotify_id, {
				artist_id,
			})

			queue_dispatch_chain_immediate('artist.meta.spotify_artist_supplementary', artist.id, ident)
			queue_complete(entry)
		})
		updated = true
	})

	return updated
}
