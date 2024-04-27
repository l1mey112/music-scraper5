import { db } from '../db'
import { nfetch } from '../fetch'
import { fs_hash_path, fs_sharded_lazy_bunfile } from '../fs'
import { mime_ext } from '../mime'
import { ident_cmd, queue_complete, queue_pop, queue_retry_later, run_with_concurrency_limit } from '../pass_misc'
import { $images } from '../schema'
import { ImageKind } from '../types'
import sizeOf from 'image-size'

// image.download.image_url
export async function pass_image_download_image_url() {
	let updated = false
	const k = queue_pop<[ImageKind, string]>('image.download.image_url')

	await run_with_concurrency_limit(k, 4, async (entry) => {
		const ident = ident_cmd(entry)
		const [image_kind, url] = entry.payload

		const resp = await nfetch(url)

		// doesn't exist, retry later
		if (!resp.ok) {
			queue_retry_later(entry)
			return
		}

		await db.transaction(async db => {
			const ext = mime_ext(resp.headers.get("content-type"))
			const [file, new_hash] = fs_sharded_lazy_bunfile(ext)

			await Bun.write(file, resp)

			const size = sizeOf(fs_hash_path(new_hash))

			if (!size.width || !size.height) {
				// so damn rare, malformed image??
				console.error(`sizeOf returned no width or height for ${new_hash}`, entry)

				queue_retry_later(entry)
				return
			}

			db.insert($images)
				.values({ hash: new_hash, ident, kind: image_kind, width: size.width, height: size.height })
				.run()


			queue_complete(entry)
			updated = true
		})
	})

	return updated
}
