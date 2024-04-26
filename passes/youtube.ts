import { sql } from "drizzle-orm";
import { db } from "../db";
import { locale_from_bcp_47 } from "../locale";
import { ident_cmd_unwrap, images_queue_url, link_insert, links_from_text, locale_insert, queue_complete, queue_dispatch_immediate, queue_pop, queue_retry_later, run_batched_zip } from "../pass_misc";
import { $youtube_video } from "../schema";
import { Locale, LocaleDesc, LocaleEntry, QueueCmd, QueueEntry } from "../types";
import { YoutubeImage, meta_youtube_video_v3 } from "./youtube_api";

function largest_image(arr: Iterable<YoutubeImage>): YoutubeImage | undefined {
	let largest: YoutubeImage | undefined = undefined;

	for (const image of arr) {
		if (!largest || image.width * image.height > largest.width * largest.height) {
			largest = image;
		}
	}

	return largest;
}

// track.new.youtube_video
export async function pass_track_new_youtube_video() {
	let updated = false
	const k = queue_pop<string>('track.new.youtube_video')

	function batch_fn(entry: QueueEntry<string>[]) {
		return meta_youtube_video_v3(entry.map(it => it.payload))
	}

	await run_batched_zip(k, 50, batch_fn, (entry, result) => {
		// not found, retry again later
		if (typeof result === 'string') {
			queue_retry_later(entry)
			return
		}

		db.transaction(db => {
			let has_loc_title = false
			let has_loc_description = false

			const youtube_id = entry.payload
			const [ident, track_id] = ident_cmd_unwrap(entry, 'track_id')

			const locales: LocaleEntry[] = []

			// localisations are higher quality
			for (const [locale_string, local] of Object.entries(result.localizations ?? {})) {
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
				if (result.defaultLanguage) {
					const locale = locale_from_bcp_47(result.defaultLanguage)
					if (locale) {
						default_video_locale = locale
					}
				}

				const title = result.title // default video language
				const description = result.description // default video language
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
			const thumb = largest_image(Object.values(result.thumbnails))

			// extract all URLs from the description, doesn't matter what locale
			const links = links_from_text(ident, result.description)

			if (thumb) {
				images_queue_url(ident, 'yt_thumbnail', thumb.url)
			}

			// nothing to add to track, just ensure its creation with `ident_pk`

			// insert with requested youtube_id id
			// drizzle doesn't support insert or replace, which is fucking annoying
			// TODO: it would be nice to have `primary key on conflict replace` for youtube_video
			//       but drizzle doesn't support this also
			db.run(sql`
				insert or replace into ${$youtube_video} (id, track_id, channel_id)
				values (${result.id}, ${track_id}, ${result.channelId})
			`)

			locale_insert(locales)
			link_insert(links)

			// reset id if possible to the new id, as the API might return a different id
			if (youtube_id != result.id) {
				db.update($youtube_video)
					.set({ id: result.id, channel_id: result.channelId, track_id })
					.where(sql`id = ${youtube_id}`)
					.run()
			}

			updated = true
			queue_dispatch_immediate('artist.new.youtube_channel', result.channelId)
			queue_complete(entry)
		})
	})

	return updated
}