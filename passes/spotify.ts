import { pass_spotify_api } from "../cred_api"
import { queue_pop, queue_retry_later, run_batched_zip } from "../pass_misc"
import { QueueCmd, QueueEntry } from "../types"

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

	await run_batched_zip(k, 50, batch_fn, (entry, result) => {
		// null (track doesn't exist), retry again later
		if (!result) {
			queue_retry_later(entry)
			return
		}

		
	})
}
