#!/usr/bin/env bun

import { sqlite } from "../db"
import { queue_dispatch_immediate } from "../pass"
import { PassIdentifier } from "../passes"

const tables: Record<string, PassIdentifier> = {
	'youtube_video': 'track.index_youtube_video',
	'spotify_track': 'track.index_spotify_track',
}

for (const [table, pass] of Object.entries(tables)) {
	const stmt = sqlite.prepare<{ id: string }, []>(`
		select id from ${table}
	`)

	let dispatched = 0
	sqlite.transaction(() => {
		for (const { id } of stmt.all()) {
			queue_dispatch_immediate(pass, id)
			dispatched++
		}
	})()

	if (dispatched > 0) {
		console.log(`dispatched ${dispatched} immediate tasks for ${table}`)
	}
}
