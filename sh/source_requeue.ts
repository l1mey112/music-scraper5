#!/usr/bin/env bun

import { sqlite } from "../db";
import { queue_dispatch_immediate } from "../pass";

// select all tracks with no source, returning the (youtube_id?, spotify_id?, ...)
const stmt = sqlite.prepare<{ track_id: string, youtube_id?: string | null, spotify_id?: string | null }, []>(`
	select t.id as track_id, yt.id as youtube_id, sp.id as spotify_id
	from track t
	left join youtube_video yt on t.id = yt.track_id
	left join spotify_track sp on t.id = sp.track_id
	where not exists (
		select 1 from source s where s.track_id = t.id
	)
`)

let dispatched = 0
sqlite.transaction(() => {
	for (const { track_id, youtube_id, spotify_id } of stmt.all()) {
		if (spotify_id) {
			queue_dispatch_immediate('source.download_from_spotify_track', spotify_id)
			dispatched++
			continue
		}
		
		if (youtube_id) {
			queue_dispatch_immediate('source.download_from_youtube_video', youtube_id)
			dispatched++
			continue
		}
	
		console.error(`track ${track_id} has no thirdparty source`)
	}
})()

if (dispatched > 0) {
	console.log(`dispatched ${dispatched} immediate tasks`)
}
