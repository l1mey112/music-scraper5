import * as YTDlpWrap from "yt-dlp-wrap"
import { db } from "../db"
import { fs_hash_delete, fs_hash_exists_some, fs_sharded_path_noext_nonlazy } from "../fs"
import { FSRef, QueueEntry } from "../types"
import { $source, $youtube_video } from "../schema"
import { get_ident, run_with_concurrency_limit } from "../pass_misc"
import { queue_again_later, queue_complete, queue_dispatch_immediate, queue_retry_failed } from "../pass"

// source.download_from_youtube_video
export function pass_source_download_from_youtube_video(entries: QueueEntry<string>[]) {
	const ytdl = new YTDlpWrap.default()

	return run_with_concurrency_limit(entries, 20, async (entry) => {
		const youtube_id = entry.payload
		const [_, track_id] = get_ident(youtube_id, $youtube_video, 'track_id')

		const [path, hash_part] = fs_sharded_path_noext_nonlazy()

		type Output = {
			ext: string
			duration: number
			bitrate: number
		}

		const args = [
			"-f",
			"bestaudio",
			`https://www.youtube.com/watch?v=${youtube_id}`,
			"-o",
			path + ".%(ext)s",
			"--no-simulate",
			"--print",
			"{\"ext\":%(ext)j,\"duration\":%(duration)j,\"bitrate\":%(abr)j}",
		]

		let output_s
		try {
			output_s = await ytdl.execPromise(args)
			console.log(`downloaded ${youtube_id}`)
		} catch (e) {
			no_log: {
				if (e instanceof Error) {
					if (e.message.includes('This video is only available to Music Premium members')) {
						queue_retry_failed(entry, 'This video is only available to Music Premium members')
						return
					} else if (e.message.includes('This live event will begin in a few moments.')) {
						queue_again_later(entry)
						return
					} else if (e.message.includes('Video unavailable')) {
						queue_retry_failed(entry, 'Video unavailable')
						return
					}
				}
			}
			console.error('failed to download youtube video', youtube_id)
			console.error(e)
			//queue_retry_failed(entry, `failed to download youtube video ${youtube_id}`)
			return
		}

		const output: Output = JSON.parse(output_s)
		const hash = (hash_part + '.' + output.ext) as FSRef

		if (!fs_hash_exists_some(hash)) {
			fs_hash_delete(hash)
			console.error('downloaded file does not exist ????', hash)
			return
		}

		db.transaction(db => {
			db.insert($source)
				.values({
					hash,
					track_id,
					bitrate: Math.round(output.bitrate), // kbps
				})
				.run()

			queue_dispatch_immediate('source.classify_chromaprint', hash) // ident is ignored
			queue_complete(entry)
		})
	})
}
