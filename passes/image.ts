import { sql } from 'drizzle-orm'
import { db } from '../db'
import { nfetch } from '../fetch'
import { fs_hash_path, fs_sharded_lazy_bunfile } from '../fs'
import { mime_ext } from '../mime'
import { queue_complete, queue_retry_failed } from '../pass'
import { get_ident, run_with_concurrency_limit } from '../pass_misc'
import { $image } from '../schema'
import { Ident, ImageKind, QueueEntry } from '../types'
import sizeOf from 'image-size'
import { wal_log } from '../wal'

// image.download_image_url
export function pass_image_download_image_url(entries: QueueEntry<[Ident, ImageKind, url: string, preferred: boolean]>[]) {
	return run_with_concurrency_limit(entries, 32, async (entry) => {
		const [ident, image_kind, url, preferred] = entry.payload

		const resp = await nfetch(url)

		// doesn't exist, just kill
		if (!resp.ok) {
			wal_log(`failed to download image from url '${url}'`, entry)
			queue_complete(entry)
			return
		}

		// check if the url exists already
		const has = db.select({ chk: sql`1` })
			.from($image)
			.where(sql`ident = ${ident} and immutable_url = ${url}`)
			.get()

		if (has) {
			queue_complete(entry)
			return
		}

		const ext = mime_ext(resp.headers.get("content-type"))
		const [file, new_hash] = fs_sharded_lazy_bunfile(ext)
		
		await Bun.write(file, resp)

		db.transaction(db => {
			const size = sizeOf(fs_hash_path(new_hash))

			if (!size.width || !size.height) {
				// so damn rare, malformed image??
				// this will leave the image in the media folder, should probably delete
				wal_log(`sizeOf returned no width or height for ${new_hash}`, entry)
				queue_complete(entry)
				return
			}

			db.insert($image)
				.values({ hash: new_hash, ident, kind: image_kind, width: size.width, height: size.height, preferred })
				.run()

			queue_complete(entry)
		})
	})
}
