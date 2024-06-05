import { sqlite } from "../db"
import { merge } from "../pass_misc"
import { TrackId } from "../types"

// with a mostly untyped query, its really annoying to have to get around drizzle
// drizzle doesn't have a bare `prepare()` api like `get()` and `all()`
// so we have to use `sqlite.prepare()`

const track_isrc = sqlite.prepare<{ track_id1: TrackId, track_id2: TrackId }, []>(`
	select a.id as track_id1, b.id as track_id2
	from track a
	join track b on a.isrc = b.isrc and a.id < b.id
`)

// wont compare two tracks with ISRCs
// this will compare spotify track with youtube, youtube with youtube, etc
// >0.90 is a foolproof match
// acoustid_compare2 returns null if either of the chromaprints are null, don't bother checking for nulls

const track_chromaprint = sqlite.prepare<{ track_id1: TrackId, track_id2: TrackId, score: number }, []>(`
	select s1.track_id as track_id1, s2.track_id as track_id2, 
		acoustid_compare2(s1.chromaprint, s2.chromaprint, 80)
		as score
	from source s1
	join source s2 on s1.track_id < s2.track_id
	where unlikely(score > 0.90) and
		s2.duration_s between s1.duration_s - 7 and s1.duration_s + 7
`)

// track.merge_using_known_heuristics
export function pass_track_merge_using_known_heuristics() {
	// this is expensive to run, bisecting it into smaller chunks is a good idea
	// 1. link all tracks together with same ISRC
	// 2. link all tracks together with same chromaprint

	// since the matches by chromaprint are so high (>90%), it wouldn't matter to check groups as well
	// as we did before in the last codebase (of >40% match on all groups)

	const tuple_set = new Set<`${TrackId},${TrackId}`>()

	function merge_set(track_id1: TrackId, track_id2: TrackId) {
		if (track_id1 < track_id2) {
			tuple_set.add(`${track_id1},${track_id2}`)
		} else {
			tuple_set.add(`${track_id2},${track_id1}`)
		}
	}

	for (const { track_id1, track_id2 } of track_isrc.all()) {
		merge_set(track_id1, track_id2)
	}

	for (const { track_id1, track_id2, score } of track_chromaprint.all()) {
		console.log(`chromaprint match ${track_id1} ${track_id2} ${score}`)
		merge_set(track_id1, track_id2)
	}

	for (const tuple of tuple_set) {
		const [track_id1, track_id2] = tuple.split(',').map(Number) as [TrackId, TrackId]
		merge('track_id', track_id1, track_id2)
	}
}
