import { sql } from "drizzle-orm"
import { db } from "../db"
import { locale_from_bcp_47 } from "../locale"
import { queue_again_later, queue_complete, queue_dispatch_immediate, queue_retry_failed } from "../pass"
import { image_queue_immutable_url, link_insert, links_from_text, locale_insert, insert_canonical, run_batched_zip, insert_track_artist, ident_id, link_urls_unknown, assert, run_with_concurrency_limit, not_exists, get_ident_or_new, get_ident } from "../pass_misc"
import { $youtube_channel, $youtube_video } from "../schema"
import { ArtistId, Ident, ImageKind, Locale, LocaleDesc, LocaleEntry, QueueEntry, TrackId } from "../types"
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

// aux.assign_track_youtube_channel
export function pass_aux_assign_track_youtube_channel(entries: QueueEntry<[TrackId, youtube_channel: string]>[]) {
	for (const entry of entries) {
		const [track_id, youtube_channel] = entry.payload
		const [_, artist_id] = get_ident(youtube_channel, $youtube_channel, 'artist_id')
		insert_track_artist(track_id, artist_id)
		queue_complete(entry)
	}
}

// track.index_youtube_video
export function pass_track_index_youtube_video(entries: QueueEntry<string>[]) {
	function batch_fn(entry: QueueEntry<string>[]) {
		return meta_youtube_video_v3(entry.map(it => it.payload))
	}

	return run_batched_zip(entries, 50, batch_fn, (entry, video) => {
		// not found, retry again later
		if (typeof video === 'string') {
			queue_retry_failed(entry)
			return
		}

		db.transaction(db => {
			let has_loc_title = false
			let has_loc_description = false

			const youtube_id = entry.payload
			const [ident, track_id] = get_ident_or_new(entry.preferred_time, youtube_id, $youtube_video, 'track_id')

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
				image_queue_immutable_url(ident, ImageKind["YouTube Thumbnail"], thumb.url, false)
			}

			insert_canonical($youtube_video, video.id, youtube_id, {
				track_id,
				channel_id: video.channelId,
			})

			if (not_exists($youtube_channel, sql`id = ${video.channelId}`)) {
				queue_dispatch_immediate('artist.index_youtube_channel', video.channelId)
				queue_dispatch_immediate('aux.assign_track_youtube_channel', [track_id, video.channelId])
			}

			locale_insert(locales)
			link_insert(links)
			queue_dispatch_immediate('source.download_from_youtube_video', youtube_id)

			queue_complete(entry)
		})
	})
}

// artist.index_youtube_channel
export function pass_artist_index_youtube_channel(entries: QueueEntry<string>[]) {
	function batch_fn(entry: QueueEntry<string>[]) {
		return meta_youtube_channel_lemmnos(entry.map(it => it.payload))
	}

	return run_batched_zip(entries, 50, batch_fn, (entry, channel) => {
		// not found, retry again later
		if (typeof channel === 'string') {
			queue_retry_failed(entry)
			return
		}

		db.transaction(db => {
			const youtube_id = entry.payload
			const [ident, artist_id] = get_ident_or_new(entry.preferred_time, youtube_id, $youtube_channel, 'artist_id')

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
					image_queue_immutable_url(ident, kind, thumb.url, false)
				}
			}

			// youtube v3 for channels doesn't actually set the `defaultLanguage` field on the snippet
			// which is fucking stupid. we have no way of telling the exact locale of a translation
			// of either the title or the description. forcing a language locale with the `?hl=` parameter
			// doesn't even work either.

			// channel title/display name isn't present in lemmnos
			// need to request elsewhere
			queue_dispatch_immediate('aux.youtube_channel0', youtube_id)
			link_insert(link_urls_unknown(ident, channel.about.links.map(it => it.url)))

			const data = {
				artist_id,
				handle: channel.about.handle,
			}

			insert_canonical($youtube_channel, channel.id, youtube_id, data)

			// repeat again in another day!
			queue_again_later(entry)
		})
	})
}

// aux.youtube_channel0
export function pass_aux_youtube_channel0(entries: QueueEntry<string>[]) {
	function batch_fn(entry: QueueEntry<string>[]) {
		return meta_youtube_channel_v3(entry.map(it => it.payload))
	}

	return run_batched_zip(entries, 50, batch_fn, (entry, channel) => {
		if (typeof channel === 'string') {
			queue_complete(entry)
			return
		}

		// this is ran after, and will take precedence over the last pass

		// even though we have no way of telling the locale of localized
		// (because youtube doesn't fucking tell us??)
		// its still higher quality as this is what people will see

		db.transaction(db => {
			const [ident, _] = get_ident(entry.payload, $youtube_channel, 'artist_id')

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
	})
}

// aux.index_youtube_playlist
export function pass_aux_index_youtube_playlist(entries: QueueEntry<string>[]) {
	return run_with_concurrency_limit(entries, 12, async (entry) => {
		const youtube_id = entry.payload

		const videos = await meta_youtube_channel_playlist(youtube_id)

		await run_with_concurrency_limit(videos.entries(), 16, async ([i, video_id]) => {
			if (!not_exists($youtube_video, sql`id = ${video_id}`)) {
				delete videos[i]
				return
			}
			if (await meta_youtube_video_is_short(video_id)) {
				delete videos[i]
			}
		})

		// videos: (string | undefined)[]

		db.transaction(db => {
			for (const video_id of videos) {
				if (video_id) {
					queue_dispatch_immediate('track.index_youtube_video', video_id)
				}
			}
			console.log(`queued ${videos.length} videos from playlist ${youtube_id}`)

			// another day
			queue_again_later(entry)
		})
	})
}
