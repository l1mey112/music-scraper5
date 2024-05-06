// initial data stores basically everything we need, but the gallery images at the bottom where the biography is
// it would be nice to have them, but it's not a priority

import { db } from "../db"
import { nfetch } from "../fetch"
import { queue_complete } from "../pass"
import { get_ident, image_queue_immutable_url, link_insert, link_urls_unknown, links_from_text, locale_insert, run_with_concurrency_limit } from "../pass_misc"
import { $spotify_artist } from "../schema"
import { ImageKind, Link, LinkEntry, LocaleDesc, LocaleEntry, QueueEntry } from "../types"

export async function spotify_raw_artist(spotify_id: string): Promise<SpotifyArtistInitialData | undefined> {	
	const url = `https://open.spotify.com/artist/${spotify_id}`
	const response = await nfetch(url)
	const text = await response.text()
	if (!response.ok) {
		return undefined
	}
	const match = text.match(/<script\s+id="initial-state"\s+type="text\/plain">([^<]+)<\/script>/)
	if (!match) {
		console.log('spotify_raw_artist: no match')
		return undefined
	}

	const data: RawArtistInitialData = JSON.parse(Buffer.from(match[1], 'base64').toString('utf-8'))
	const qn = `spotify:artist:${spotify_id}`

	const qnd = data.entities.items[qn]
	let ret: SpotifyArtistInitialData
	try {
		ret = {
			followers: qnd.stats.followers,
			monthly_listeners: qnd.stats.monthlyListeners,
			avatar_extracted_colour_dark: qnd.visuals.avatarImage?.extractedColors.colorDark?.hex,
			avatar_extracted_colour_raw: qnd.visuals.avatarImage?.extractedColors.colorRaw?.hex,
			external_links: qnd.profile.externalLinks.items.map(v => v.url),
			biography: qnd.profile.biography.text,
			header_images: qnd.visuals.headerImage?.sources ?? [],
		}
	} catch (e) {
		console.log('spotify_raw_artist: caught', e)
		console.log(qnd)
		return undefined
	}

	return ret
}

// aux.spotify_artist0
export function pass_aux_spotify_artist0(entries: QueueEntry<string>[]) {
	return run_with_concurrency_limit(entries, 16, async (entry) => {
		const spotify_id = entry.payload
		const data = await spotify_raw_artist(spotify_id)
		if (!data) {
			return
		}

		db.transaction(db => {
			const [ident, _] = get_ident(spotify_id, $spotify_artist, 'artist_id')

			const links: LinkEntry[] = link_urls_unknown(ident, data.external_links)

			if (data.biography) {
				links.push(...links_from_text(ident, data.biography))

				const bio: LocaleEntry = {
					ident,
					desc: LocaleDesc.description,
					text: data.biography,
					preferred: true,
				}

				locale_insert(bio)
			}

			link_insert(links)

			if (data.header_images.length > 0) {
				const largest: SpotifyImage | undefined = data.header_images.reduce((a, b) => a.width * a.height > b.width * b.height ? a : b)

				if (largest) {
					image_queue_immutable_url(ident, ImageKind["Spotify Artist Banner"], largest.url, false)
				}
			}

			queue_complete(entry)
		})
	})
}

type SpotifyImage = {
	height: number
	url: string
	width: number
}

type SpotifyArtistInitialData = {
	followers: number
	monthly_listeners: number
	avatar_extracted_colour_dark?: string // hex
	avatar_extracted_colour_raw?: string // hex
	external_links: string[]
	biography: string | null
	header_images: SpotifyImage[]
}

interface RawArtistInitialData {
	entities: {
		items: {
			[key: string]: {
				profile: {
					biography: {
						text: string
					}
					externalLinks: {
						items: {
							// name: string
							url: string
						}[]
					}
					// name: string
				}
				stats: {
					followers: number
					monthlyListeners: number
				}
				visuals: {
					avatarImage?: {
						extractedColors: {
							colorDark?: {
								hex: string
							} | null
							colorRaw?: {
								hex: string
							} | null
						}
						sources: SpotifyImage[]
					} | null
					headerImage?: {
						sources: SpotifyImage[]
					} | null
				}
			}
		}
	}
}
