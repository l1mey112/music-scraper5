// initial data stores basically everything we need, but the gallery images at the bottom where the biography is
// it would be nice to have them, but it's not a priority

import { db } from "../db"
import { nfetch } from "../fetch"
import { ident_cmd_unwrap_new, images_queue_url, link_insert, link_urls_unknown, links_from_text, locale_insert, queue_complete, queue_pop, run_with_concurrency_limit } from "../pass_misc"
import { ImageKind, Link, LinkEntry, LocaleDesc, LocaleEntry } from "../types"

export async function spotify_raw_artist(spotify_id: string): Promise<SpotifyArtistInitialData | undefined> {	
	const url = `https://open.spotify.com/artist/${spotify_id}`
	const response = await nfetch(url)
	const text = await response.text()
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
			avatar_extracted_colour_dark: qnd.visuals.avatarImage.extractedColors.colorDark?.hex,
			avatar_extracted_colour_raw: qnd.visuals.avatarImage.extractedColors.colorRaw?.hex,
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

// artist.meta.spotify_artist_supplementary
export async function pass_artist_meta_spotify_supplementary() {
	let updated = false
	const k = queue_pop<string>('artist.meta.spotify_artist_supplementary')

	await run_with_concurrency_limit(k, 4, async (entry) => {
		const spotify_id = entry.payload
		const data = await spotify_raw_artist(spotify_id)
		if (!data) {
			return
		}

		db.transaction(db => {
			const [ident, _] = ident_cmd_unwrap_new(entry, 'artist_id')

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
					images_queue_url(ident, ImageKind["Spotify Artist Banner"], largest.url)
				}
			}

			queue_complete(entry)
		})
		updated = true
	})

	return updated
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
					avatarImage: {
						extractedColors: {
							colorDark?: {
								hex: string
							} | null
							colorRaw?: {
								hex: string
							} | null
						}
						sources: SpotifyImage[]
					}
					headerImage?: {
						sources: SpotifyImage[]
					} | null
				}
			}
		}
	}
}
