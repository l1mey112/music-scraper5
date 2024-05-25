import { sql } from "drizzle-orm"
import { $spotify_track } from "../schema"
import { pass_spotify_user } from "../cred"
import { not_exists, run_with_concurrency_limit } from "../pass_misc"
import { QueueEntry } from "../types"
import { queue_again_later, queue_dispatch_immediate } from "../pass"

// TODO: whilst it uses the current user, this can have issues if the track isn't available in the region
//       for an unbiased API search/index, use the client credentials flow/not the saved tracks API.
//       this will require double request/overhead

// aux.index_spotify_liked
export async function pass_aux_index_spotify_liked(entries: QueueEntry<0>[]) {
	const { api } = await pass_spotify_user()

	const ini = await api.currentUser.tracks.savedTracks(1)
	let total = ini.total

	const offsets = Array.from({ length: Math.ceil(total / 50) }, (_, i) => i * 50)

	await run_with_concurrency_limit(offsets, 12, async offset => {
		const tracks = await api.currentUser.tracks.savedTracks(50, offset)

		for (const { track, added_at } of tracks.items) {
			const time = new Date(added_at).getTime()

			if (not_exists($spotify_track, sql`id = ${track.id}`)) {
				queue_dispatch_immediate('track.index_spotify_track', track.id, time)
			}
		}
	})

	// because unique on (pass, payload) only one of these can exist
	// but just be safe	
	for (const entry of entries) {
		queue_again_later(entry)
	}
}
