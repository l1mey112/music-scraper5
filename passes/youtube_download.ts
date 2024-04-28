import * as YTDlpWrap from "yt-dlp-wrap"
import { db, sqlite } from "../db"
import { ident_cmd_unwrap_new, queue_complete, queue_pop, queue_retry_later, run_with_concurrency_limit } from "../pass_misc"
import { fs_sharded_path_noext_nonlazy } from "../fs"
import { FSRef } from "../types"
import { $source, $youtube_video } from "../schema"
import { sql } from "drizzle-orm"

const has_video_source = sqlite.prepare<number, [string]>(`
	select 1
	from youtube_video
	where id = ? and source is not null
`)

// source.download.from_youtube_video
export async function pass_source_download_from_youtube_video() {
	// use a queue command to allow for easy retrying
	// without this, we'd have to use seperate heuristics to determine failed entries
	let updated = false
	const k = queue_pop<string>('source.download.from_youtube_video')

	if (k.length === 0) {
		return
	}
	
	const ytdl = new YTDlpWrap.default()

	await run_with_concurrency_limit(k, 20, async (entry) => {
		const youtube_id = entry.payload
		const [ident, track_id] = ident_cmd_unwrap_new(entry, 'track_id')

		const already_has_source = has_video_source.get(youtube_id)
		if (already_has_source) {
			return
		}

		const [path, hash_part] = fs_sharded_path_noext_nonlazy()

		type Output = {
			ext: string
			width: number
			height: number
			duration: number
			bitrate: number
		}

		const args = [
			"-f",
			"bestvideo+bestaudio/best",
			`https://www.youtube.com/watch?v=${youtube_id}`,
			"-o",
			path + ".%(ext)s",
			"--no-simulate",
			"--print",
			"{\"ext\":%(ext)j,\"width\":%(width)j,\"height\":%(height)j,\"duration\":%(duration)j,\"bitrate\":%(abr)j}",
		]

		let output_s
		try {
			output_s = await ytdl.execPromise(args)
		} catch (e) {
			console.log('source.download.from_youtube_video: caught', e)
			queue_retry_later(entry)
			return
		}

		const output: Output = JSON.parse(output_s)
		const hash = (hash_part + '.' + output.ext) as FSRef

		db.transaction(db => {
			db.insert($source)
				.values({
					hash,
					track_id,
					width: output.width,
					height: output.height,
					bitrate: output.bitrate,
				})
				.run()

			db.update($youtube_video)
				.set({ source: hash })
				.where(sql`id = ${youtube_id}`)
				.run()

			queue_complete(entry)
		})
		updated = true
	})

	return updated
}
