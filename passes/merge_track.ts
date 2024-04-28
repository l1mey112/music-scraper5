import { sql } from "drizzle-orm"
import { db, sqlite } from "../db"
import { ident, queue_pop } from "../pass_misc"
import { $album_track, $external_links, $images, $locale, $source, $spotify_track, $track, $track_artist, $youtube_video } from "../schema"
import { FSRef, Ident, TrackId } from "../types"

// with a mostly untyped query, its really annoying to have to get around drizzle
// drizzle doesn't have a bare `prepare()` api like `get()` and `all()`
// so we have to use `sqlite.prepare()`

/* // QUERY PLAN
// |--SEARCH sources USING PRIMARY KEY (hash=?)
// |--SEARCH t USING COVERING INDEX sources.audio_fingerprint.idx (duration_s>? AND duration_s<?)
// `--USE TEMP B-TREE FOR ORDER BY
const match_hash = sqlite.prepare<{ hash: FSRef, score: number }, [FSRef]>(`
	select t.hash, acoustid_compare2(t.chromaprint, target.chromaprint, 80) as score from
		sources t,
		(select hash, chromaprint, duration_s from sources where hash = ?) target
	where
		t.track_id not null and t.chromaprint not null and t.hash != target.hash
		and unlikely(score > 0.75)
		and t.duration_s between target.duration_s - 7 and target.duration_s + 7
	order by score desc
`)

// return a list of scores for a given FSRef matching to all in a track

// QUERY PLAN
// |--SCAN t USING INDEX sources.idx
// `--SEARCH sources USING PRIMARY KEY (hash=?)
const track_hash = sqlite.prepare<{ duration_s: number, score: number }, [FSRef, TrackId]>(`
	select t.duration_s, acoustid_compare2(t.chromaprint, target.chromaprint, 80) as score from
		sources t,
		(select chromaprint from sources where hash = ?) target
	where
		track_id = ?
`) */

const track_isrc = sqlite.prepare<{ track_id1: TrackId, track_id2: TrackId }, []>(`
	select a.id as track_id1, b.id as track_id2
	from track a
	join track b on a.isrc = b.isrc and a.id < b.id
`)

// wont compare two tracks with ISRCs
// this will compare spotify track with youtube, youtube with youtube, etc
// >0.90 is a foolproof match
// acoustid_compare2 returns null if either of the chromaprints are null, don't bother checking for nulls

// which one is better? i don't know
// the query plan for the second one looks nicer

/* const track_chromaprint = sqlite.prepare<{ track_id1: TrackId, track_id2: TrackId, score: number }, []>(`
	select t1.id as track_id1, t2.id as track_id2, acoustid_compare2(t1s.chromaprint, t2s.chromaprint, 80) as score
	from track t1
		full outer join track t2 on t1.id < t2.id
		inner join source t1s on t1.id = t1s.track_id
		inner join source t2s on t2.id = t2s.track_id
	where (t1.isrc is null or t2.isrc is null)
		and unlikely(score > 0.90)
		and t2s.duration_s between t1s.duration_s - 7 and t1s.duration_s + 7
	order by score desc
`) */

const track_chromaprint = sqlite.prepare<{ track_id1: TrackId, track_id2: TrackId, score: number }, []>(`
	select t1.id as track_id1, t2.id as track_id2, acoustid_compare2(t1s.chromaprint, t2s.chromaprint, 80) as score
	from source t1s
		inner join track t1 on t1.id = t1s.track_id
		inner join source t2s on t2.id = t2s.track_id
		full outer join track t2 on t1.id < t2.id
	where (t1.isrc is null or t2.isrc is null)
		and unlikely(score > 0.90)
		and t2s.duration_s between t1s.duration_s - 7 and t1s.duration_s + 7
	order by score desc
`)

// will need to go ahead and merge one into the other
function merge_track(track_id1: TrackId, track_id2: TrackId) {
	const migration_tables_track_id = [
		$track_artist, $album_track,
		$youtube_video, $spotify_track,
		$source,
	]

	const migration_tables_ident = [
		$images,
		$locale,
		$external_links,
	]

	const track_id1_ident = ident(track_id1, 'track_id')
	const track_id2_ident = ident(track_id2, 'track_id')

	db.transaction(db => {
		// merge track_id2 into track_id1
		for (const table of migration_tables_track_id) {
			db.update(table)
				.set({ track_id: track_id1 })
				.where(sql`track_id = ${track_id2}`)
				.run()
		}
		
		for (const table of migration_tables_ident) {
			db.update(table)
				.set({ ident: track_id1_ident })
				.where(sql`ident = ${track_id2_ident}`)
				.run()
		}

		// perform a merge using two selects, merge object, then delete and update
		// it is convoluted and slow, but simpler logic using JS and typechecked using drizzle

		const track_id1_obj = db.select()
			.from($track)
			.where(sql`id = ${track_id1}`)
			.get()!

		const track_id2_obj = db.select()
			.from($track)
			.where(sql`id = ${track_id2}`)
			.get()!

		const merged_track = {
			...track_id1_obj,
			...track_id2_obj,
		}

		delete (merged_track as any).id // sure

		db.delete($track)
			.where(sql`id = ${track_id2}`)
			.run()

		db.update($track)
			.set(merged_track)
			.where(sql`id = ${track_id1}`)
			.run()
	})

	console.log(`merged track ${track_id1_ident} into ${track_id2_ident}`)
}

// track.merge.using_known_heuristics
export function pass_track_merge_using_known_heuristics() {
	let updated = false
	const k = queue_pop<FSRef>('track.merge.using_known_heuristics')

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

	for (const { track_id1, track_id2 } of track_chromaprint.all()) {
		merge_set(track_id1, track_id2)
	}

	for (const tuple of tuple_set) {
		const [track_id1, track_id2] = tuple.split(',').map(Number) as [TrackId, TrackId]
		merge_track(track_id1, track_id2)
	}
}
