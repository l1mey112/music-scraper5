import { sql } from "drizzle-orm";
import { db } from "../db";
import { fs_root } from "../fs";
import { not_exists } from "../pass_misc";
import { $youtube_channel, $youtube_video } from "../schema";
import { queue_dispatch_immediate } from "../pass";
import { pass_spotify_user } from "../cred";
import { MaybePromise } from "../types";

function seed_youtube_video(id: string) {
	if (not_exists($youtube_video, sql`id = ${id}`)) {
		queue_dispatch_immediate('track.index_youtube_video', id)
	}
}

function seed_youtube_channel(id: string) {
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

	if (not_exists($youtube_channel, sql`id = ${id}`)) {
		queue_dispatch_immediate('artist.index_youtube_channel', id)
	}

	// will ignore if (pass, payload) exists already
	// because of this, it won't reset the expire timer as it should
	queue_dispatch_immediate('aux.index_youtube_playlist', 'UU' + id.slice(2))
}

async function seed_spotify_user(command: string) {
	switch (command) {
		case 'liked': {
			const _ = await pass_spotify_user() // ensure

			// only one of these can exist at a time
			queue_dispatch_immediate('aux.index_spotify_liked', 0)
			break
		}
		default: {
			console.error(`unknown spotify_user seed command: ${command} (ignorning)`)
			break
		}
	}
}

const seedto: Record<string, (id: string) => MaybePromise<void>> = {
	'youtube_video.seed': seed_youtube_video,
	'youtube_channel.seed': seed_youtube_channel,
	'spotify_user.seed': seed_spotify_user,
}

async function seed_root() {
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

		await db.transaction(async db => {
			// list of payloads separated by line
			for (let line of lines) {
				line = line.split('#', 1)[0]
				line = line.trim()

				if (line.length === 0) {
					continue
				}

				await pass_entry(line)
			}
		})

		console.log(`seed file: ${seed} (${lines.length} commands)`)
	}
}

await seed_root()
