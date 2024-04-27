import sizeOf from 'image-size'
import { ident_cmd, queue_pop, run_with_concurrency_limit } from '../pass_misc'
import { ImageKind } from '../types'

// image.download.image_url
export async function pass_image_download_image_url() {
	let updated = false
	const k = queue_pop<[ImageKind, string]>('image.download.image_url')

	await run_with_concurrency_limit(k, 4, async (entry) => {
		const ident = ident_cmd(entry)
		const [image_kind, url] = entry.payload

		
	})
}
