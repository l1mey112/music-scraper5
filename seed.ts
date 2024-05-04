import { sql } from "drizzle-orm";
import { db } from "./db";
import { fs_root } from "./fs";
import { not_exists } from "./pass_misc";
import { $youtube_channel, $youtube_video } from "./schema";
import { queue_dispatch_immediate } from "./pass";

function seed_youtube_video(id: string): 0 | 1 {
	if (not_exists($youtube_video, sql`id = ${id}`)) {
		queue_dispatch_immediate('track.index_youtube_video', id)
		return 1
	}
	return 0
}

function seed_youtube_channel(id: string): 0 | 1 {
	// https://stackoverflow.com/questions/18953499/youtube-api-to-fetch-all-videos-on-a-channel

	// to extract uploads, take youtube ID and change UC to UU
	//
	//       reol channel id: UCB6pJFaFByws3dQj4AdLdyA
	//                        ^^
	// reol uploads playlist: UUB6pJFaFByws3dQj4AdLdyA
	//                        ^^
	//
	// https://www.youtube.com/playlist?list=UUB6pJFaFByws3dQj4AdLdyA
	//                                       ^^^^^^^^^^^^^^^^^^^^^^^^

	let r: 0 | 1 = 0 // best effort, not exact

	if (not_exists($youtube_channel, sql`id = ${id}`)) {
		queue_dispatch_immediate('artist.index_youtube_channel', id)
		r = 1
	}

	// will ignore if (pass, payload) exists already
	// because of this, it won't reset the expire timer as it should
	queue_dispatch_immediate('aux.index_youtube_playlist', 'UU' + id.slice(2))

	return r
}

const seedto: Record<string, (id: string) => 0 | 1> = {
	'youtube_video.seed': seed_youtube_video,
	'youtube_channel.seed': seed_youtube_channel,
}

for (const seed in seedto) {
	const pass_entry = seedto[seed]
	const fp = `${fs_root}/${seed}`
	const file = Bun.file(fp)

	if (!await file.exists()) {
		continue
	}

	// i would like a lines() API bun.
	const text = await file.text()
	const lines = text.split('\n')

	let amount = 0

	db.transaction(db => {
		// list of payloads separated by line
		for (let line of lines) {
			line = line.split('#', 1)[0]
			line = line.trim()

			if (line.length === 0) {
				continue
			}

			amount += pass_entry(line)
		}
	})

	console.log(`seed file: ${seed} (${amount})`)
}