import { sql } from "drizzle-orm"
import { db } from "../db"
import { $kv_store } from "../schema"
import { pass_spotify_user } from "../cred"
import { queue_dispatch_chain_immediate, run_with_concurrency_limit } from "../pass_misc"

// TODO: whilst it uses the current user, this can have issues if the track isn't available in the region
//       for an unbiased API search/index, use the client credentials flow/not the saved tracks API.
//       this will require double request/overhead

type IndexData = {
	[user_id: string]: number
}

function kv_get(): IndexData {
	const kv = db.select({ data: $kv_store.data })
		.from($kv_store)
		.where(sql`kind = 'spotify_index_liked'`)
		.get() as { data: IndexData } | undefined

	if (!kv) {
		return {}
	}

	return kv.data
}

function kv_store(data: IndexData) {
	db.insert($kv_store)
		.values({ kind: 'spotify_index_liked', data })
		.onConflictDoUpdate({
			target: [$kv_store.kind],
			set: { data },
		})
		.run()
}

// track.new.spotify_index_liked
export async function pass_track_new_spotify_index_liked() {
	const [api, user] = await pass_spotify_user()

	const indexdata = kv_get()
	let watermark = indexdata[user.id] || 0

	// songs are added to the top
	// fetch from bottom up

	// - xxxx __ - index 0
	// o xxxx   \ watermark level
	// o xxxx
	// o xxxx __ zero watermark

	const ini = await api.currentUser.tracks.savedTracks(1)
	let total = ini.total

	let offset = total - watermark
	if (offset > 0) {
		offset = Math.max(0, offset - 50)

		const offsets = Array.from({ length: Math.ceil(offset / 50) }, (_, i) => i * 50)

		await run_with_concurrency_limit(offsets, 8, async offset => {
			const tracks = await api.currentUser.tracks.savedTracks(50, offset)

			for (const { track } of tracks.items) {
				queue_dispatch_chain_immediate('track.new.spotify_track', track.id)
			}

			console.log(`fetched ${tracks.items.length} tracks, total ${watermark + tracks.items.length} / ${total}`)

			watermark += tracks.items.length
		})

		watermark = total
	}

	indexdata.user_id = watermark
	kv_store(indexdata)
}
