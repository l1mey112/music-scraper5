import { db } from "../db"
import { locale_from_bcp_47 } from "../locale"
import { ident_cmd_unwrap_new, images_queue_url, link_insert, links_from_text, locale_insert, queue_complete, queue_dispatch_immediate, queue_pop, queue_retry_later, insert_canonical, run_batched_zip, insert_track_artist, ident_id, queue_dispatch_chain_returning, link_urls_unknown, queue_dispatch_later, assert, run_with_concurrency_limit, queue_dispatch_seed, ident_cmd } from "../pass_misc"
import { $youtube_channel, $youtube_video } from "../schema"
import { ArtistId, ImageKind, Locale, LocaleDesc, LocaleEntry, QueueEntry } from "../types"
import { YoutubeImage, meta_youtube_channel_lemmnos, meta_youtube_channel_playlist, meta_youtube_channel_v3, meta_youtube_video_is_short, meta_youtube_video_v3 } from "./youtube_api"

function largest_image(arr: Iterable<YoutubeImage>): YoutubeImage | undefined {
	let largest: YoutubeImage | undefined = undefined

	for (const image of arr) {
		if (!largest || image.width * image.height > largest.width * largest.height) {
			largest = image
		}
	}

	return largest
}

// track.new.youtube_video
export async function pass_track_new_youtube_video() {
	let updated = false
	const k = queue_pop<string>('track.new.youtube_video')

	function batch_fn(entry: QueueEntry<string>[]) {
		return meta_youtube_video_v3(entry.map(it => it.payload))
	}

	await run_batched_zip(k, 50, batch_fn, (entry, video) => {
		// not found, retry again later
		if (typeof video === 'string') {
			queue_retry_later(entry)
			return
		}

		db.transaction(db => {
			let has_loc_title = false
			let has_loc_description = false

			const youtube_id = entry.payload
			const [ident, track_id] = ident_cmd_unwrap_new(entry, 'track_id')

			const locales: LocaleEntry[] = []

			// localisations are higher quality
			for (const [locale_string, local] of Object.entries(video.localizations ?? {})) {
				const locale = locale_from_bcp_47(locale_string)
				if (!locale) {
					continue
				}
				const title = local.title
				const description = local.description

				if (title) {
					locales.push({
						ident,
						locale,
						desc: LocaleDesc.name,
						text: title,
						preferred: false,
					})
					has_loc_title = true
				}
				if (description) {
					locales.push({
						ident,
						locale,
						desc: LocaleDesc.description,
						text: description,
						preferred: true,
					})
					has_loc_description = true
				}
			}

			{
				// this gets lower quality than localizations, insert last

				let default_video_locale: undefined | Locale
				if (video.defaultLanguage) {
					const locale = locale_from_bcp_47(video.defaultLanguage)
					if (locale) {
						default_video_locale = locale
					}
				}

				const title = video.title // default video language
				const description = video.description // default video language
				if (!has_loc_title) {
					locales.push({
						ident,
						locale: default_video_locale,
						desc: LocaleDesc.name,
						text: title,
						preferred: false,
					})
				}

				if (!has_loc_description) {
					locales.push({
						ident,
						locale: default_video_locale,
						desc: LocaleDesc.description,
						text: description,
						preferred: true,
					})
				}
			}

			// youtube provides many different thumbnails, and we may choose a thumbnail that isn't actually the displayed thumbnail
			// though the largest one is probably the right one...
			const thumb = largest_image(Object.values(video.thumbnails))

			// extract all URLs from the description, doesn't matter what locale
			const links = links_from_text(ident, video.description)

			if (thumb) {
				images_queue_url(ident, ImageKind["YouTube Thumbnail"], thumb.url)
			}

			insert_canonical($youtube_video, video.id, youtube_id, {
				track_id,
				channel_id: video.channelId,
			})

			const artist_ident = queue_dispatch_chain_returning('artist.new.youtube_channel', video.channelId)
			insert_track_artist(track_id, ident_id<ArtistId>(artist_ident))

			locale_insert(locales)
			link_insert(links)
			queue_dispatch_immediate('source.download.from_youtube_video', youtube_id, ident)

			queue_complete(entry)
		})
		updated = true
	})

	return updated
}

// artist.new.youtube_channel
// *<id> means do not probe the entire channel
export async function pass_artist_new_youtube_channel() {
	let updated = false
	const k = queue_pop<string>('artist.new.youtube_channel')

	function batch_fn(entry: QueueEntry<string>[]) {
		return meta_youtube_channel_lemmnos(entry.map(it => it.payload))
	}

	await run_batched_zip(k, 50, batch_fn, (entry, channel) => {
		// not found, retry again later
		if (typeof channel === 'string') {
			queue_retry_later(entry)
			return
		}

		db.transaction(db => {
			const star = entry.payload.startsWith('*')
			const youtube_id = star ? entry.payload.slice(1) : entry.payload
			const [ident, artist_id] = ident_cmd_unwrap_new(entry, 'artist_id')

			type ChannelKey = Exclude<keyof typeof channel.images, 'tvBanner' | 'mobileBanner'>

			const img_map: Record<ChannelKey, ImageKind> = {
				avatar: ImageKind["Profile Art"],
				banner: ImageKind["YouTube Banner"],
				//tvBanner: ImageKind["YouTube TV Banner"],
				//mobileBanner: ImageKind["YouTube Mobile Banner"],
			}

			for (const [key, kind] of Object.entries(img_map)) {
				const images = channel.images[key as ChannelKey]
				if (!images) {
					continue
				}
	
				const thumb = largest_image(images)
	
				if (thumb) {
					images_queue_url(ident, kind, thumb.url)
				}
			}

			// youtube v3 for channels doesn't actually set the `defaultLanguage` field on the snippet
			// which is fucking stupid. we have no way of telling the exact locale of a translation
			// of either the title or the description. forcing a language locale with the `?hl=` parameter
			// doesn't even work either.

			// channel title/display name isn't present in lemmnos
			// need to request elsewhere
			queue_dispatch_immediate('artist.meta.youtube_channel_aux', youtube_id, ident)

			if (star) {
				// index literally every single video
				console.log('indexing youtube channel', youtube_id)
				queue_dispatch_immediate('artist.index.youtube_channel', youtube_id)
			}

			link_insert(link_urls_unknown(ident, channel.about.links.map(it => it.url)))

			const data = {
				artist_id,
				handle: channel.about.handle,
			}

			insert_canonical($youtube_channel, channel.id, youtube_id, data)

			// repeat again in another day!
			queue_retry_later(entry)
		})
		updated = true
	})

	return updated
}

// artist.meta.youtube_channel_aux
export async function pass_artist_meta_youtube_channel_aux() {
	let updated = false
	const k = queue_pop<string>('artist.meta.youtube_channel_aux')

	function batch_fn(entry: QueueEntry<string>[]) {
		return meta_youtube_channel_v3(entry.map(it => it.payload))
	}

	await run_batched_zip(k, 50, batch_fn, (entry, channel) => {
		if (typeof channel === 'string') {
			queue_complete(entry)
			return
		}

		// this is ran after, and will take precedence over the last pass

		// even though we have no way of telling the locale of localized
		// (because youtube doesn't fucking tell us??)
		// its still higher quality as this is what people will see

		db.transaction(db => {
			assert(entry.target)
			const [ident, artist_id] = ident_cmd_unwrap_new(entry, 'artist_id')

			if (channel.description) {
				const description: LocaleEntry = {
					ident,
					desc: LocaleDesc.description,
					text: channel.localized.description,
					preferred: true,
				}

				locale_insert(description)
			}

			const display_name: LocaleEntry = {
				ident,
				desc: LocaleDesc.name,
				text: channel.localized.title,
				preferred: true,
			}

			locale_insert(display_name)
			queue_complete(entry)
		})
		updated = true
	})

	return updated
}

// artist.index.youtube_channel
export function pass_artist_index_youtube_channel() {
	const k = queue_pop<string>('artist.index.youtube_channel')

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

	for (const entry of k) {
		const youtube_id = entry.payload
		
		assert(youtube_id.startsWith('UC'))

		const ident = ident_cmd(entry)
		const playlist_id = 'UU' + youtube_id.slice(2)

		queue_dispatch_immediate('track.seed.youtube_playlist', playlist_id, ident)
		queue_retry_later(entry) // *.index.* passes repeat
	}

	return k.length > 0
}

// track.seed.youtube_playlist
export async function pass_track_seed_youtube_playlist() {
	let updated = false
	const k = queue_pop<string>('track.seed.youtube_playlist')

	await run_with_concurrency_limit(k, 4, async (entry) => {
		const youtube_id = entry.payload

		const videos = await meta_youtube_channel_playlist(youtube_id)

		await run_with_concurrency_limit(videos.entries(), 4, async ([i, video_id]) => {
			if (await meta_youtube_video_is_short(video_id)) {
				delete videos[i]
			}
		})

		// videos: (string | undefined)[]

		db.transaction(db => {
			for (const video_id of videos) {
				if (video_id) {
					queue_dispatch_seed('track.new.youtube_video', video_id)
				}
			}
			console.log(`queued ${videos.length} videos from playlist ${youtube_id}`)
			queue_complete(entry)
		})
		updated = true
	})

	return updated
}
