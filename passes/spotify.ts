import { db } from "../db"
import { AlbumId, ArtistId, ImageKind, LocaleDesc, LocaleEntry, QueueEntry, TrackId } from "../types"
import { $spotify_album, $spotify_artist, $spotify_track } from "../schema"
import { get_ident, get_ident_or_new, not_exists, image_queue_immutable_url, insert_album_track, insert_canonical, insert_track_artist, locale_insert, run_batched_zip } from "../pass_misc"
import { queue_again_later, queue_complete, queue_dispatch_immediate, queue_retry_failed } from "../pass"
import { sql } from "drizzle-orm"
import { pass_new_spotify_api } from "../cred"

// aux.assign_track_spotify_artist
export function pass_aux_assign_track_spotify_artist(entries: QueueEntry<[TrackId, spotify_artist: string]>[]) {
	for (const entry of entries) {
		const [track_id, spotify_artist] = entry.payload
		const [_, artist_id] = get_ident(spotify_artist, $spotify_artist, 'artist_id')
		insert_track_artist(track_id, artist_id)
		queue_complete(entry)
	}
}

// aux.assign_album_spotify_track
export function pass_aux_assign_album_spotify_track(entries: QueueEntry<[AlbumId, spotify_track: string]>[]) {
	for (const entry of entries) {
		const [album_id, spotify_track] = entry.payload
		const [_, track_id] = get_ident(spotify_track, $spotify_track, 'track_id')
		insert_album_track(album_id, track_id)
		queue_complete(entry)
	}
}

// track.index_spotify_track
export async function pass_track_index_spotify_track(entries: QueueEntry<string>[]) {
	function batch_fn(entry: QueueEntry<string>[]) {
		const api = pass_new_spotify_api()
		return api.tracks.get(entry.map(it => it.payload))
	}

	// > A comma-separated list of the Spotify IDs. For example: ...
	// > Maximum: 100 IDs.

	// they lied here, it's 50

	return run_batched_zip(entries, 50, batch_fn, (entry, track) => {
		const api = pass_new_spotify_api()
		// null (track doesn't exist), retry again later
		if (!track) {
			queue_retry_failed(entry, `track not found (${entry.payload})`)
			return
		}

		db.transaction(db => {
			const spotify_id = entry.payload
			const isrc: string | null | undefined = track.external_ids.isrc
			const [ident, track_id] = get_ident_or_new(entry.preferred_time, spotify_id, $spotify_track, 'track_id', { isrc })

			const spotify_album_id = track.album.id

			const name: LocaleEntry = {
				ident,
				desc: LocaleDesc.name,
				text: track.name,
				preferred: true,
			}

			if (not_exists($spotify_album, sql`id = ${spotify_album_id}`)) {
				queue_dispatch_immediate('album.index_spotify_album', spotify_album_id)
			}
			for (const artist of track.artists) {
				//const ident = queue_dispatch_chain_returning('artist.new.spotify_artist', it.id)
				queue_dispatch_immediate('artist.index_spotify_artist', artist.id)
				queue_dispatch_immediate('aux.assign_track_spotify_artist', [track_id, artist.id])
			}

			locale_insert(name)

			const data = {
				track_id,
				preview_url: track.preview_url,
			}

			insert_canonical($spotify_track, track.id, spotify_id, data)
			queue_dispatch_immediate('source.download_from_spotify_track', spotify_id)
			queue_complete(entry)
		})
	})
}

// album.index_spotify_album
export function pass_album_index_spotify_album(entries: QueueEntry<string>[]) {
	function batch_fn(entry: QueueEntry<string>[]) {
		const api = pass_new_spotify_api()
		return api.albums.get(entry.map(it => it.payload))
	}

	return run_batched_zip(entries, 20, batch_fn, async (entry, album) => {
		const api = pass_new_spotify_api()
		// null (track doesn't exist), retry again later
		if (!album) {
			queue_retry_failed(entry, `album not found (${entry.payload})`)
			return
		}

		return db.transaction(async db => {
			const spotify_id = entry.payload
			const [ident, album_id] = get_ident_or_new(entry.preferred_time, spotify_id, $spotify_album, 'album_id')

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

			for (const track of tracks) {
				if (not_exists($spotify_track, sql`id = ${track.id}`)) {
					queue_dispatch_immediate('track.index_spotify_track', track.id)
				}
				queue_dispatch_immediate('aux.assign_album_spotify_track', [album_id, track.id])
			}

			const name: LocaleEntry = {
				ident,
				desc: LocaleDesc.name,
				text: album.name,
				preferred: true,
			}

			for (const artist of album.artists) {
				if (not_exists($spotify_artist, sql`id = ${artist.id}`)) {
					queue_dispatch_immediate('artist.index_spotify_artist', artist.id)
				}
			}

			locale_insert(name)

			// > The cover art for the album in various sizes, widest first.
			// TODO: some tracks which are so fucked, you can't include
			//       but we do anyway. its the users choice at the end of the day
			const largest = album.images[0]
			if (largest) {
				image_queue_immutable_url(ident, ImageKind["Cover Art"], largest.url, true)
			}

			insert_canonical($spotify_album, album.id, spotify_id, {
				album_id,
			})

			queue_complete(entry)
		})
	})
}

// artist.index_spotify_artist
export function pass_artist_index_spotify_artist(entries: QueueEntry<string>[]) {
	function batch_fn(entry: QueueEntry<string>[]) {
		const api = pass_new_spotify_api()
		return api.artists.get(entry.map(it => it.payload))
	}

	// > A comma-separated list of the Spotify IDs. For example: ...
	// > Maximum: 100 IDs.

	// they lied here AGAIN, it's 50

	return run_batched_zip(entries, 50, batch_fn, (entry, artist) => {
		// null (track doesn't exist), retry again later
		if (!artist) {
			queue_retry_failed(entry, `artist not found (${entry.payload})`)
			return
		}

		db.transaction(db => {
			const spotify_id = entry.payload
			const [ident, artist_id] = get_ident_or_new(entry.preferred_time, spotify_id, $spotify_artist, 'artist_id')

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
				image_queue_immutable_url(ident, ImageKind["Profile Art"], largest.url, true)
			}

			insert_canonical($spotify_artist, artist.id, spotify_id, {
				artist_id,
			})

			queue_dispatch_immediate('aux.spotify_artist0', artist.id)

			// repeat another day
			queue_again_later(entry)
		})
	})
}
